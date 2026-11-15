import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { fieldHash, wrap, xmlEscape } from "../lib/desk.js";

const CardInput = z.object({
  kicker: z.string().min(1).max(24),
  headline: z.string().min(1).max(90),
  dek: z.string().max(140),
  stat: z.string().max(24).optional(),
  sourceName: z.string().min(1).max(40),
});

type CardFields = {
  KICKER: string;
  HEADLINE: string;
  DEK: string;
  STAT: string;
  SOURCE: string;
};

function cardSvg(fields: CardFields): string {
  const headline = wrap(fields.HEADLINE, 22, 4)
    .map((line, index) => `<tspan x="80" dy="${index === 0 ? 0 : 78}">${xmlEscape(line)}</tspan>`)
    .join("");
  const dek = wrap(fields.DEK, 42, 3)
    .map((line, index) => `<tspan x="80" dy="${index === 0 ? 0 : 40}">${xmlEscape(line)}</tspan>`)
    .join("");
  const stat = fields.STAT.trim()
    ? `<text x="80" y="980" fill="#d7a441" font-family="Georgia, serif" font-size="72">${xmlEscape(fields.STAT)}</text>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <rect width="1080" height="1350" fill="#121510"/>
  <rect width="16" height="1350" fill="#d7a441"/>
  <text x="80" y="140" fill="#d7a441" font-family="Arial, Helvetica, sans-serif" font-size="28" letter-spacing="4">${xmlEscape(fields.KICKER.toUpperCase())}</text>
  <text x="80" y="280" fill="#f4f1ea" font-family="Georgia, serif" font-size="64">${headline}</text>
  <text x="80" y="720" fill="#a39e93" font-family="Arial, Helvetica, sans-serif" font-size="28">${dek}</text>
  ${stat}
  <text x="80" y="1240" fill="#f4f1ea" font-family="Arial, Helvetica, sans-serif" font-size="24">${xmlEscape(fields.SOURCE)}</text>
  <text x="80" y="1285" fill="#a39e93" font-family="Arial, Helvetica, sans-serif" font-size="20">Finance desk · Not investment advice</text>
</svg>`;
}

type CanvaResult =
  | { status: "not_configured" }
  | { status: "ready"; editUrl: string; designId: string }
  | { status: "pending"; jobId: string }
  | { status: "failed"; detail: string }
  | { status: "dry_run" };

function readString(value: unknown, path: readonly string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

function canvaDetail(status: number, body: unknown): string {
  const message = readString(body, ["message"]).slice(0, 180);
  return message ? `Canva returned ${status}: ${message}` : `Canva returned ${status}.`;
}

async function openCanva(fields: CardFields, cachedUrl: string, cachedDesign: string): Promise<CanvaResult> {
  if (cachedUrl) return { status: "ready", editUrl: cachedUrl, designId: cachedDesign };
  const token = process.env.CANVA_ACCESS_TOKEN?.trim();
  const template = process.env.CANVA_BRAND_TEMPLATE_ID?.trim();
  if (!token || !template) return { status: "not_configured" };
  const data: Record<string, { type: "text"; text: string }> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) data[key] = { type: "text", text: value };
  }
  try {
    const created = await fetch("https://api.canva.com/rest/v1/autofills", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        brand_template_id: template,
        title: fields.HEADLINE.slice(0, 80),
        data,
      }),
    });
    const createdBody: unknown = await created.json().catch(() => null);
    if (!created.ok) return { status: "failed", detail: canvaDetail(created.status, createdBody) };
    const jobId = readString(createdBody, ["job", "id"]);
    if (!jobId) return { status: "failed", detail: "Canva did not return a job id." };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const polled = await fetch(`https://api.canva.com/rest/v1/autofills/${encodeURIComponent(jobId)}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${token}` },
      });
      const body: unknown = await polled.json().catch(() => null);
      if (!polled.ok) return { status: "failed", detail: canvaDetail(polled.status, body) };
      const status = readString(body, ["job", "status"]);
      if (status === "failed") {
        return {
          status: "failed",
          detail: "Canva autofill failed. The template fields must be named KICKER, HEADLINE, DEK, STAT, and SOURCE.",
        };
      }
      if (status === "success") {
        const editUrl =
          readString(body, ["job", "result", "design", "urls", "edit_url"]) ||
          readString(body, ["job", "result", "design", "url"]);
        if (!editUrl) return { status: "failed", detail: "Canva finished without a design URL." };
        const designId = readString(body, ["job", "result", "design", "id"]);
        return { status: "ready", editUrl, designId };
      }
    }
    return { status: "pending", jobId };
  } catch {
    return { status: "failed", detail: "Canva timed out." };
  }
}

export default defineTool({
  description: prompt`
    Build the Instagram card and, when Canva is connected, autofill the brand template.
    Template text fields must be named KICKER, HEADLINE, DEK, STAT, and SOURCE.
    Call this after copy, before send-for-approval. Same fields return the same card.
  `,
  effect: "idempotent",
  inputSchema: CardInput,
  dryRunResult: (input) => ({
    cardPath: "cards/dry-run.svg",
    stored: false,
    canva: { status: "dry_run" } as CanvaResult,
    kicker: input.kicker,
    headline: input.headline,
  }),
  async execute(input, ctx) {
    const fields: CardFields = {
      KICKER: input.kicker.trim(),
      HEADLINE: input.headline.trim(),
      DEK: input.dek.trim(),
      STAT: input.stat?.trim() ?? "",
      SOURCE: input.sourceName.trim(),
    };
    const hash = fieldHash(fields);
    const cardPath = `cards/${hash}.svg`;
    const svg = cardSvg(fields);
    let stored = false;
    try {
      await ctx.host.files.write(cardPath, svg, { scope: "deployment" });
      stored = true;
    } catch {
      stored = false;
    }
    const cacheKey = `desk:canva:${hash}`;
    const cached = await ctx.host.kv.get(cacheKey);
    const cachedUrl =
      cached && typeof cached === "object" && "editUrl" in cached && typeof cached.editUrl === "string"
        ? cached.editUrl
        : "";
    const cachedDesign =
      cached && typeof cached === "object" && "designId" in cached && typeof cached.designId === "string"
        ? cached.designId
        : "";
    const canva = await openCanva(fields, cachedUrl, cachedDesign);
    if (canva.status === "ready" && (canva.editUrl !== cachedUrl || canva.designId !== cachedDesign)) {
      await ctx.host.kv.put(cacheKey, { editUrl: canva.editUrl, designId: canva.designId });
    }
    return { cardPath, stored, canva, kicker: fields.KICKER, headline: fields.HEADLINE };
  },
});
