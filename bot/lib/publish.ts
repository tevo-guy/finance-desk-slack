import type { HostKvApi } from "@grok/agent-sdk";

export type Pack = {
  packId: string;
  headline: string;
  post: string;
  thread: string[];
  caption: string;
  designId: string;
  canvaUrl: string;
  canonical: string;
  channel: string;
  threadTs: string;
  at: string;
};

export type StagedPack = {
  packId: string;
  status: "staged";
  xText: string;
  instagramCaption: string;
  cardUrl: string;
  stagedAt: string;
};

function isPack(value: unknown): value is Pack {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.packId === "string" &&
    typeof row.headline === "string" &&
    typeof row.post === "string" &&
    Array.isArray(row.thread) &&
    typeof row.caption === "string" &&
    typeof row.canvaUrl === "string"
  );
}

/**
 * Record an approved pack. Makes no network call.
 * Metricool is a later step; until then Approve only saves the pack.
 */
export async function stagePack(
  kv: HostKvApi,
  packId: string,
): Promise<StagedPack | { status: "unknown_pack" | "already_staged"; packId: string }> {
  const existing = await kv.get(`desk:staged:${packId}`);
  if (existing !== undefined) return { status: "already_staged", packId };

  const raw = await kv.get(`desk:pack:${packId}`);
  if (!isPack(raw)) return { status: "unknown_pack", packId };

  const staged: StagedPack = {
    packId,
    status: "staged",
    xText: [raw.post, ...raw.thread.filter((line) => typeof line === "string")].join("\n\n"),
    instagramCaption: raw.caption,
    cardUrl: raw.canvaUrl,
    stagedAt: new Date().toISOString(),
  };
  await kv.put(`desk:staged:${packId}`, staged);
  return staged;
}
