import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["audience"],
  description: "A broad story wins over a newer niche wire.",
  async test(t) {
    await t.send(
      [
        "The wires are already in. Do not call scan-sources. Do not call send-for-approval.",
        "Draft one pack and call make-graphic once.",
        "Story A, newer: Luxor said hackers redirected hashrate from a dozen client accounts through its Commander mining tool. Source: Decrypt. URL: https://decrypt.co/example-luxor",
        "Story B: US spot bitcoin ETFs took in $1.1 billion in one day. Source: CoinDesk. URL: https://www.coindesk.com/markets/example-etf. The figure $1.1 billion is in the source.",
        "Pick the story a broad X and Instagram audience would repost. Skip niche mining news.",
      ].join("\n"),
    );
    t.succeeded();
    t.notCalledTool("send-for-approval");
    t.calledTool("make-graphic", {
      count: 1,
      input: (value) => {
        const headline =
          value && typeof value === "object" && "headline" in value
            ? String((value as { headline?: unknown }).headline)
            : "";
        return /bitcoin|etf/i.test(headline) && !/luxor|hashrate/i.test(headline);
      },
    });
  },
});
