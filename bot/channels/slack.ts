import { slackChannel } from "@grok/agent-sdk/channels/slack";
import { stagePack } from "../lib/publish.js";

const PACK_ID = /^[a-f0-9]{12}$/;

function approverIds(): Set<string> {
  const raw = process.env.FINANCE_DESK_APPROVER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^U[A-Z0-9]+$/.test(id)),
  );
}

function receipt(staged: { xText: string; instagramCaption: string; cardUrl: string }): string {
  const card = staged.cardUrl ? `\n\nCard\n${staged.cardUrl}` : "\n\nCard\nText card only. Canva is not connected.";
  return [
    "Approved. Nothing was posted.",
    "This pack is saved here until Metricool is connected.",
    "",
    "X",
    staged.xText,
    "",
    "Instagram",
    staged.instagramCaption,
    card,
  ].join("\n");
}

export default slackChannel({
  envPrefix: "FINANCE_DESK",
  suggestedPromptsTitle: "Finance desk",
  suggestedPrompts: [
    {
      title: "What's trending",
      message: "What finance or crypto story would a broad audience repost right now? Do not send it to Slack yet.",
    },
    {
      title: "Send the trending story",
      message: "Pick the verified story a broad X and Instagram audience would repost, draft the post and card, and send the pack to Slack for approval.",
    },
  ],
  onBlockAction: async (ctx, action) => {
    if (!["desk_approve", "desk_hold", "desk_kill"].includes(action.actionId)) return null;
    const packId = action.value;
    if (!PACK_ID.test(packId)) return null;

    if (!approverIds().has(action.userId)) {
      await ctx.thread.post("Not authorized. Ask an approver to click this.");
      return null;
    }

    if (action.actionId === "desk_hold") {
      await ctx.host.kv.put(`desk:decision:${packId}`, { decision: "hold", by: action.userId, at: new Date().toISOString() });
      await ctx.thread.post("Held. Nothing was posted.");
      return null;
    }

    if (action.actionId === "desk_kill") {
      await ctx.host.kv.put(`desk:decision:${packId}`, { decision: "kill", by: action.userId, at: new Date().toISOString() });
      await ctx.host.kv.put(`desk:sent:${packId}`, { at: new Date().toISOString(), canonical: "killed" });
      await ctx.thread.post("Killed. This story will not be drafted again.");
      return null;
    }

    await ctx.host.kv.put(`desk:decision:${packId}`, { decision: "approve", by: action.userId, at: new Date().toISOString() });
    const staged = await stagePack(ctx.host.kv, packId);
    if (staged.status !== "staged") {
      const text =
        staged.status === "already_staged"
          ? "Already approved. Nothing was posted."
          : "This pack is unknown to the desk.";
      await ctx.thread.post(text);
      return null;
    }
    await ctx.thread.post(receipt(staged));
    return null;
  },
});
