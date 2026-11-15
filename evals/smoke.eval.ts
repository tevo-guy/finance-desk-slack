import { defineEval, includes } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "A verified story becomes an X post and an Instagram card, and it is not sent.",
  async test(t) {
    await t.send(
      [
        "The story is already verified. Draft from it.",
        "Do not call scan-sources. Do not call send-for-approval.",
        "Call make-graphic.",
        "Headline: Bitcoin ETFs see $1.1 billion of inflows in one day.",
        "Source name: CoinDesk.",
        "The figure $1.1 billion is in the source. Do not add other numbers.",
      ].join(" "),
    );
    t.succeeded();
    t.calledTool("make-graphic");
    t.notCalledTool("send-for-approval");
    t.check(t.reply, includes(/ETF|inflow/i));
  },
});
