import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import type { KnownBlock } from "@slack/types";
import * as z from "zod/v4";
import {
  canonicalUrl,
  freshStories,
  overlaps,
  packIdFor,
  readStories,
  slackEscape,
  sourceClass,
  unsupportedNumber,
  type SourceClass,
} from "../lib/desk.js";
import type { Pack } from "../lib/publish.js";

const SCAN_KEY = "desk:scan";

const Input = z.object({
  headline: z.string().min(1).max(180),
  post: z.string().min(1).max(500),
  thread: z.array(z.string().min(1).max(500)).max(3).optional(),
  caption: z.string().min(1).max(2200),
  sources: z.array(z.object({ url: z.string().min(1).max(500), title: z.string().min(1).max(300) })).min(1).max(6),
  cardPath: z.string().regex(/^cards\/[a-f0-9]{16}\.svg$/).optional(),
  stat: z.string().max(24).optional(),
});

type Cited = {
  url: string;
  canonical: string;
  sourceClass: SourceClass;
  title: string;
};

async function pageText(url: string): Promise<string | null> {
  const kind = sourceClass(url);
  if (kind !== "primary" && kind !== "wire") return null;
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "text/html, text/plain", "user-agent": "finance-desk/0.1" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      const next = new URL(location, url).toString();
      const nextKind = sourceClass(next);
      if (nextKind !== "primary" && nextKind !== "wire") return null;
      const followed = await fetch(next, {
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: { accept: "text/html, text/plain", "user-agent": "finance-desk/0.1" },
      });
      if (!followed.ok) return null;
      const text = (await followed.text()).slice(0, 200_000);
      return text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    }
    if (!response.ok) return null;
    const text = (await response.text()).slice(0, 200_000);
    return text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  } catch {
    return null;
  }
}

function blocksFor(input: {
  headline: string;
  post: string;
  thread: string[];
  caption: string;
  sources: Cited[];
  canvaUrl: string;
  packId: string;
}): KnownBlock[] {
  const thread = input.thread.length
    ? `\n\n${input.thread.map((line, index) => `*${index + 2}.* ${slackEscape(line)}`).join("\n")}`
    : "";
  const sources = input.sources
    .map((source) => `• ${slackEscape(source.sourceClass)} · <${source.canonical}|${slackEscape(source.title)}>`)
    .join("\n");
  const blocks: KnownBlock[] = [
    { type: "header", text: { type: "plain_text", text: "Finance desk · approval", emoji: false } },
    { type: "section", text: { type: "mrkdwn", text: `*X*\n${slackEscape(input.post)}${thread}` } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*Instagram*\n${slackEscape(input.caption)}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Sources*\n${sources}` } },
  ];
  if (input.canvaUrl) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Canva*\n<${input.canvaUrl}|Open the card>` },
    });
  }
  blocks.push({
    type: "actions",
    block_id: "desk_decision",
    elements: [
      {
        type: "button",
        action_id: "desk_approve",
        style: "primary",
        value: input.packId,
        text: { type: "plain_text", text: "Approve", emoji: false },
      },
      {
        type: "button",
        action_id: "desk_hold",
        value: input.packId,
        text: { type: "plain_text", text: "Hold", emoji: false },
      },
      {
        type: "button",
        action_id: "desk_kill",
        style: "danger",
        value: input.packId,
        text: { type: "plain_text", text: "Kill", emoji: false },
      },
    ],
  });
  return blocks;
}

export default defineTool({
  description: prompt`
    Send one verified pack to the Slack approval channel with Approve, Hold, and Kill buttons.
    Refuses when the only sources are X posts, when a number is not in the evidence,
    or when the same story was already sent. Nothing posts until a person clicks Approve.
  `,
  effect: "write",
  inputSchema: Input,
  dryRunResult: (input) => ({ delivered: false, reason: "dry_run", headline: input.headline }),
  async execute(input, ctx) {
    const thread = input.thread ?? [];
    const tooLong = [input.post, ...thread].find((line) => [...line].length > 280);
    if (tooLong) return { delivered: false, reason: "post_over_280", length: [...tooLong].length };

    const cited: Cited[] = [];
    for (const source of input.sources) {
      const canonical = canonicalUrl(source.url);
      if (!canonical) continue;
      cited.push({
        url: source.url,
        canonical,
        sourceClass: sourceClass(source.url),
        title: source.title,
      });
    }
    const usable = cited.filter((source) => source.sourceClass === "primary" || source.sourceClass === "wire");
    if (usable.length === 0) {
      return { delivered: false, reason: "social_or_unknown_only" };
    }

    const cached = freshStories(readStories(await ctx.host.kv.get(SCAN_KEY)), Date.now());
    const confirmed: Cited[] = [];
    const evidence: string[] = [];
    for (const source of usable) {
      const hit = cached.find((item) => item.canonical === source.canonical);
      const cachedText = hit ? `${hit.title}\n${hit.summary}` : "";
      if (hit && overlaps(input.headline, cachedText)) {
        confirmed.push(source);
        evidence.push(cachedText);
        continue;
      }
      const page = await pageText(source.canonical);
      if (page && overlaps(input.headline, page)) {
        confirmed.push(source);
        evidence.push(page.slice(0, 8_000));
      }
    }
    if (confirmed.length === 0) {
      return { delivered: false, reason: "source_not_confirmed" };
    }

    const evidenceText = evidence.join("\n");
    const claim = [input.headline, input.post, ...thread, input.caption, input.stat ?? ""].join("\n");
    const number = unsupportedNumber(claim, evidenceText);
    if (number) return { delivered: false, reason: "unsupported_number", number };

    const lead = confirmed[0];
    if (!lead) return { delivered: false, reason: "source_not_confirmed" };
    const packId = packIdFor(lead.canonical);
    if (!packId) return { delivered: false, reason: "source_not_confirmed" };

    if (ctx.session.purpose === "eval") {
      return { delivered: false, reason: "eval", packId, verdict: "pass" };
    }
    if ((await ctx.host.kv.get(`desk:sent:${packId}`)) !== undefined) {
      return { delivered: false, reason: "already_sent", packId };
    }

    const cardPath = input.cardPath;
    const svg = cardPath
      ? await ctx.host.files.read(cardPath, { scope: "deployment", encoding: "utf8" })
      : undefined;
    const canvaKey = cardPath ? `desk:canva:${cardPath.slice("cards/".length, -".svg".length)}` : "";
    const canvaRecord = canvaKey ? await ctx.host.kv.get(canvaKey) : undefined;
    const canvaUrl =
      canvaRecord && typeof canvaRecord === "object" && "editUrl" in canvaRecord && typeof canvaRecord.editUrl === "string"
        ? canvaRecord.editUrl
        : "";
    const designId =
      canvaRecord && typeof canvaRecord === "object" && "designId" in canvaRecord && typeof canvaRecord.designId === "string"
        ? canvaRecord.designId
        : "";

    const channel = process.env.FINANCE_DESK_SLACK_CHANNEL?.trim() ?? "";
    if (!/^[CG][A-Z0-9]+$/.test(channel)) {
      return {
        delivered: false,
        reason: "slack_channel_unset",
        packId,
        headline: input.headline,
        post: input.post,
        canvaUrl,
      };
    }

    try {
      const client = await ctx.host.slack.getClient();
      const fallback = `Approval needed: ${input.headline}`.replace(/\s+/g, " ").slice(0, 200);
      const posted = await client.chat.postMessage({
        channel,
        text: fallback,
        unfurl_links: false,
        unfurl_media: false,
        blocks: blocksFor({
          headline: input.headline,
          post: input.post,
          thread,
          caption: input.caption,
          sources: confirmed,
          canvaUrl,
          packId,
        }),
      });
      const threadTs = typeof posted.ts === "string" ? posted.ts : "";
      if (svg && threadTs) {
        await client.files.uploadV2({
          channel_id: channel,
          thread_ts: threadTs,
          filename: "instagram-card.svg",
          title: input.headline.slice(0, 80),
          content: svg,
        });
      }
      const record: Pack = {
        packId,
        headline: input.headline,
        post: input.post,
        thread,
        caption: input.caption,
        designId,
        canvaUrl,
        canonical: lead.canonical,
        channel,
        threadTs,
        at: new Date().toISOString(),
      };
      await ctx.host.kv.put(`desk:pack:${packId}`, record);
      await ctx.host.kv.put(`desk:sent:${packId}`, { at: record.at, canonical: lead.canonical });
      return { delivered: true, packId, channel, threadTs, canvaUrl };
    } catch {
      return { delivered: false, reason: "slack_not_connected", packId, headline: input.headline, post: input.post };
    }
  },
});
