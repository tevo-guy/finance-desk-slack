import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { COACHING_KEY, STANDING_BRIEF, readBook } from "../lib/coaching.js";

export default defineTool({
  description: prompt`
    Read the audience brief and the notes the editor has saved.
    Call this before choosing a story. The brief outranks recency.
    Notes are extra rules from the person. Apply both.
  `,
  effect: "read",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const book = readBook(await ctx.host.kv.get(COACHING_KEY));
    return { brief: STANDING_BRIEF, notes: book.notes };
  },
});
