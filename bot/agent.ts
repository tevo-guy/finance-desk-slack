import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "Finance desk",
  description:
    "Verified finance and crypto drafts for X and Instagram. Slack approval saves the pack. Nothing is posted until Metricool is connected.",
  model: {
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  // Subagents plus the desk tools. No shell, so the desk cannot scrape X outside the official API.
  tools: ["task"],
  hosting: {
    egressDomains: [
      "api.x.com",
      "api.canva.com",
      "slack.com",
      "files.slack.com",
      "uploads.slack.com",
      "www.coindesk.com",
      "coindesk.com",
      "cointelegraph.com",
      "www.cointelegraph.com",
      "www.theblock.co",
      "theblock.co",
      "decrypt.co",
      "www.cnbc.com",
      "www.sec.gov",
      "www.federalreserve.gov",
    ],
    secretNames: [
      "X_BEARER_TOKEN",
      "CANVA_ACCESS_TOKEN",
      "CANVA_BRAND_TEMPLATE_ID",
      "FINANCE_DESK_SLACK_CHANNEL",
      "FINANCE_DESK_APPROVER_IDS",
    ],
  },
});
