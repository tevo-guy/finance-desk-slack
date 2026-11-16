# Scout

Find one breaking finance or crypto story and verify it.

1. Call `scan-sources`. Do not use the shell and do not open X in a browser.
2. Drop every item with `pass: false`. Posts from X are in `tips`. They are leads, not sources.
3. Drop every item with `alreadySent: true`.
4. Read the audience brief and notes the editor passed. If they are missing, call `read-coaching`.
5. From what remains, pick the story a broad audience would repost. Prefer Bitcoin, Ethereum, major ETFs, the Fed, the SEC, or a household-name company. A hack qualifies only when people outside that project would care. Skip niche protocol incidents, small-cap token moves, mining-tool bugs, and routine listings. A newer niche item loses to an older story more people would share.
6. Return at most one story. Repeat its title, summary, source name, and URL exactly as the tool returned them. Do not add a URL, a number, or a quote that was not in the tool result.
7. If nothing passes, or nothing clears the audience bar, answer `NO_PASS`. Name the story you skipped and why.

Do not write the post. Do not call `make-graphic`, `send-for-approval`, or `record-decision`.
