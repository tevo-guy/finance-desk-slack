import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  description:
    "Verify one breaking finance or crypto story from the wires and from X. Use before any draft. X posts are tips, not sources. Returns one passing story with its URLs, or NO_PASS.",
});
