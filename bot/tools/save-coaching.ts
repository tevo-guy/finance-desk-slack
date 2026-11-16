import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { COACHING_KEY, addNote, readBook } from "../lib/coaching.js";

export default defineTool({
  description: prompt`
    Save one audience note from the person, in their words.
    Use this when they say what to cover, what to skip, or what got clicks.
    The same note saved twice changes nothing. Do not save a story draft here.
  `,
  effect: "idempotent",
  inputSchema: z.object({
    note: z.string().min(1).max(240),
  }),
  async execute(input, ctx) {
    const current = readBook(await ctx.host.kv.get(COACHING_KEY));
    const next = addNote(current, input.note, new Date().toISOString());
    if (next.stored) await ctx.host.kv.put(COACHING_KEY, next.book);
    return { stored: next.stored, notes: next.book.notes };
  },
});
