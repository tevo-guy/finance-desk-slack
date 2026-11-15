# Scout

Find one breaking finance or crypto story and verify it.

1. Call `scan-sources`. Do not use the shell and do not open X in a browser.
2. Drop every item with `pass: false`. Posts from X are in `tips`. They are leads, not sources.
3. Drop every item with `alreadySent: true`.
4. Prefer a primary source over a wire. Prefer the newest item whose summary states a concrete event: a filing, a rate decision, an outage, an ETF flow, an enforcement action, a hack, or a listing.
5. Return at most one story. Repeat its title, summary, source name, and URL exactly as the tool returned them. Do not add a URL, a number, or a quote that was not in the tool result.
6. If nothing passes, answer `NO_PASS`. Name the strongest tip in one line and mark it unverified.

Do not write the post. Do not call `make-graphic`, `send-for-approval`, or `record-decision`.
