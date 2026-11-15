import { createHash } from "node:crypto";

export type SourceClass = "primary" | "wire" | "social" | "other";

const PRIMARY = [
  "sec.gov",
  "federalreserve.gov",
  "treasury.gov",
  "cftc.gov",
  "whitehouse.gov",
  "ecb.europa.eu",
  "bankofengland.co.uk",
  "binance.com",
  "coinbase.com",
  "kraken.com",
];

const WIRE = [
  "coindesk.com",
  "theblock.co",
  "cointelegraph.com",
  "decrypt.co",
  "reuters.com",
  "cnbc.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "apnews.com",
  "axios.com",
  "barrons.com",
  "marketwatch.com",
];

export type CachedStory = {
  canonical: string;
  title: string;
  summary: string;
  sourceName: string;
  fetchedAt: string;
};

export function hostOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matches(host: string, names: readonly string[]): boolean {
  return names.some((name) => host === name || host.endsWith(`.${name}`));
}

export function sourceClass(raw: string): SourceClass {
  const host = hostOf(raw);
  if (!host) return "other";
  if (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com")) return "social";
  if (matches(host, PRIMARY)) return "primary";
  if (matches(host, WIRE)) return "wire";
  return "other";
}

export function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (key === "ref" || key.startsWith("utm_")) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function packIdFor(raw: string): string | null {
  const canonical = canonicalUrl(raw);
  if (!canonical) return null;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

export function fieldHash(fields: Readonly<Record<string, string>>): string {
  const body = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key] ?? ""}`)
    .join("\n");
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

const STOP = new Set([
  "with",
  "from",
  "that",
  "this",
  "have",
  "after",
  "into",
  "over",
  "under",
  "about",
  "their",
  "will",
  "been",
  "were",
  "says",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$%]+/g, " ")
    .split(" ")
    .filter((word) => word.length >= 4 && !STOP.has(word));
}

/** True when the claim uses words that actually appear in the evidence. */
export function overlaps(claim: string, evidence: string): boolean {
  const words = [...new Set(tokens(claim))];
  if (words.length === 0) return false;
  const hay = evidence.toLowerCase();
  const hits = words.filter((word) => hay.includes(word));
  return hits.length >= Math.min(2, words.length);
}

/** First number in `text` that the evidence does not contain. URLs are ignored. */
export function unsupportedNumber(text: string, evidence: string): string | null {
  const stripped = text.replace(/https?:\/\/\S+/g, " ");
  const found = stripped.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  const hay = evidence.replace(/,/g, "");
  for (const raw of found) {
    const norm = raw.replace(/,/g, "");
    if (!hay.includes(norm) && !evidence.includes(raw)) return raw;
  }
  return null;
}

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function wrap(text: string, width: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > width) {
      lines.push(current);
      if (lines.length === maxLines) return lines;
      current = word;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export function readStories(value: unknown): CachedStory[] {
  if (!value || typeof value !== "object" || !("items" in value)) return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: CachedStory[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.canonical !== "string" ||
      typeof row.title !== "string" ||
      typeof row.summary !== "string" ||
      typeof row.sourceName !== "string" ||
      typeof row.fetchedAt !== "string"
    ) {
      continue;
    }
    out.push({
      canonical: row.canonical,
      title: row.title,
      summary: row.summary,
      sourceName: row.sourceName,
      fetchedAt: row.fetchedAt,
    });
  }
  return out;
}

export function freshStories(items: readonly CachedStory[], nowMs: number): CachedStory[] {
  const cutoff = nowMs - 6 * 60 * 60 * 1000;
  return items.filter((item) => {
    const at = Date.parse(item.fetchedAt);
    return Number.isFinite(at) && at >= cutoff;
  });
}

export function decodeXml(text: string): string {
  const withoutCdata = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutTags = withoutCdata.replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/&#(\d+);/g, (_match, digits: string) => {
      const code = Number(digits);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
