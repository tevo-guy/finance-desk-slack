import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  canonicalUrl,
  decodeXml,
  freshStories,
  packIdFor,
  readStories,
  sourceClass,
  type CachedStory,
} from "../lib/desk.js";

const FEEDS: { name: string; url: string }[] = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "The Block", url: "https://www.theblock.co/rss.xml" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "CNBC Finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  { name: "SEC", url: "https://www.sec.gov/news/pressreleases.rss" },
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
];

const SCAN_KEY = "desk:scan";

type Story = {
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  summary: string;
  sourceClass: "primary" | "wire" | "social" | "other";
  pass: boolean;
  alreadySent: boolean;
};

async function fetchText(url: string): Promise<{ ok: true; text: string } | { ok: false; status: number | "timeout" }> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5",
        "user-agent": "finance-desk/0.1",
      },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const text = await response.text();
    return { ok: true, text: text.slice(0, 500_000) };
  } catch {
    return { ok: false, status: "timeout" };
  }
}

function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1]) : "";
}

function pickLink(block: string): string {
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (href?.[1]) return decodeXml(href[1]);
  const text = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  if (text?.[1]) return decodeXml(text[1]);
  const guid = block.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
  if (guid?.[1]?.includes("http")) return decodeXml(guid[1]);
  return "";
}

function parseFeed(xml: string, sourceName: string): Omit<Story, "pass" | "alreadySent" | "sourceClass">[] {
  const tag = xml.includes("<item") ? "item" : "entry";
  const blocks = [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map(
    (match) => match[1] ?? "",
  );
  const stories: Omit<Story, "pass" | "alreadySent" | "sourceClass">[] = [];
  for (const block of blocks.slice(0, 6)) {
    const title = tagText(block, "title");
    const url = pickLink(block);
    if (!title || !url.startsWith("https://")) continue;
    const summary = (tagText(block, "description") || tagText(block, "summary") || tagText(block, "content")).slice(0, 400);
    const publishedAt =
      tagText(block, "pubDate") || tagText(block, "published") || tagText(block, "updated") || tagText(block, "dc:date");
    stories.push({ title, url, sourceName, publishedAt, summary });
  }
  return stories;
}

type XStatus = { status: "not_configured" | "ok" | "unavailable"; detail?: string; tips: Story[] };

async function searchX(): Promise<XStatus> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return { status: "not_configured", tips: [] };
  const endpoint = new URL("https://api.x.com/2/tweets/search/recent");
  endpoint.searchParams.set(
    "query",
    '(bitcoin OR ethereum OR crypto OR "federal reserve" OR "interest rate" OR SEC OR ETF OR stablecoin) lang:en -is:retweet -is:reply',
  );
  endpoint.searchParams.set("max_results", "10");
  endpoint.searchParams.set("tweet.fields", "created_at,author_id");
  endpoint.searchParams.set("expansions", "author_id");
  endpoint.searchParams.set("user.fields", "username,name");
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(8_000),
      headers: { authorization: `Bearer ${token}` },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return { status: "unavailable", detail: `X returned ${response.status}.`, tips: [] };
    }
    const data = body && typeof body === "object" && "data" in body ? (body as { data?: unknown }).data : undefined;
    const usersRaw =
      body && typeof body === "object" && "includes" in body
        ? (body as { includes?: { users?: unknown } }).includes?.users
        : undefined;
    const names = new Map<string, string>();
    if (Array.isArray(usersRaw)) {
      for (const user of usersRaw) {
        if (!user || typeof user !== "object") continue;
        const row = user as { id?: unknown; username?: unknown };
        if (typeof row.id === "string" && typeof row.username === "string") names.set(row.id, row.username);
      }
    }
    const tips: Story[] = [];
    if (Array.isArray(data)) {
      for (const tweet of data) {
        if (!tweet || typeof tweet !== "object") continue;
        const row = tweet as { id?: unknown; text?: unknown; author_id?: unknown; created_at?: unknown };
        if (typeof row.id !== "string" || typeof row.text !== "string") continue;
        const username = typeof row.author_id === "string" ? names.get(row.author_id) : undefined;
        const url = username
          ? `https://x.com/${username}/status/${row.id}`
          : `https://x.com/i/web/status/${row.id}`;
        tips.push({
          title: row.text.replace(/\s+/g, " ").trim().slice(0, 180),
          url,
          sourceName: username ? `@${username}` : "X",
          publishedAt: typeof row.created_at === "string" ? row.created_at : "",
          summary: row.text.replace(/\s+/g, " ").trim().slice(0, 280),
          sourceClass: "social",
          pass: false,
          alreadySent: false,
        });
      }
    }
    return { status: "ok", tips };
  } catch {
    return { status: "unavailable", detail: "X search timed out.", tips: [] };
  }
}

export default defineTool({
  description: prompt`
    Read finance and crypto wires, plus recent X posts when X_BEARER_TOKEN is set.
    Call this before drafting. Items with pass true are citeable.
    Items in tips, and every X URL, are leads only. Do not cite them as the source.
  `,
  effect: "read",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(12).optional(),
  }),
  async execute(input, ctx) {
    const limit = input.limit ?? 8;
    const now = new Date();
    const fetchedAt = now.toISOString();
    const feedResults = await Promise.all(
      FEEDS.map(async (feed) => {
        const result = await fetchText(feed.url);
        if (!result.ok) return { source: feed.name, error: String(result.status), stories: [] as ReturnType<typeof parseFeed> };
        return { source: feed.name, error: "", stories: parseFeed(result.text, feed.name) };
      }),
    );
    const previous = freshStories(readStories(await ctx.host.kv.get(SCAN_KEY)), now.getTime());
    const byUrl = new Map<string, CachedStory>(previous.map((item) => [item.canonical, item]));
    const wires: Story[] = [];
    for (const feed of feedResults) {
      for (const story of feed.stories) {
        const canonical = canonicalUrl(story.url);
        const kind = sourceClass(story.url);
        if (!canonical || (kind !== "wire" && kind !== "primary")) continue;
        byUrl.set(canonical, {
          canonical,
          title: story.title,
          summary: story.summary,
          sourceName: story.sourceName,
          fetchedAt,
        });
        const packId = packIdFor(story.url);
        const sent = packId ? await ctx.host.kv.get(`desk:sent:${packId}`) : undefined;
        wires.push({
          ...story,
          url: canonical,
          sourceClass: kind,
          pass: true,
          alreadySent: sent !== undefined,
        });
      }
    }
    const stamp = (value: string) => {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const seen = new Set<string>();
    const unique = wires.filter((story) => {
      if (seen.has(story.url)) return false;
      seen.add(story.url);
      return true;
    });
    unique.sort((a, b) => stamp(b.publishedAt) - stamp(a.publishedAt));
    const trimmed = unique.slice(0, limit);
    const cache = [...byUrl.values()].slice(-80);
    await ctx.host.kv.put(SCAN_KEY, { items: cache });
    const x = await searchX();
    return {
      fetchedAt,
      wires: trimmed,
      tips: x.tips.slice(0, 5),
      x: { status: x.status, ...(x.detail ? { detail: x.detail } : {}) },
      feedErrors: feedResults.filter((feed) => feed.error).map((feed) => ({ source: feed.source, status: feed.error })),
    };
  },
});
