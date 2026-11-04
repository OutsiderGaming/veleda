---
workflow: general-video
flow: automation
storyboard: no
message: "Buy any stretch of time, in one trade, on Solana"
destination: hackathon-submission
aspect: 1920x1080
language: en
audience: Encode Club Solana Hackathon judges, Consumer App track
length: about 3:30 (limit 4:00)
---

## Intent

Veleda's submission video. Four parts: why fixed yes/no deadlines are blunt, the whole flow for someone new to Solana, why Solana, and liquidity providers. The script is in `docs/08-demo-run-sheet.md`.

## Assets

- footage/<beat>.mp4: phone recordings, one per beat f1 to f9, dropped in when recorded.
- voice/final/<beat>.wav: the user's own voiceover, replacing the scratch voice.

## Customizations

- Zoom into the tree to individual hours, then out to the whole market.
- Mock of a typical fixed-deadline market, with no third-party branding, labelled as an illustration.

## Notes

- Scratch voice is macOS `say`, for timing only.
- Part 4 and the five-year market are not live, and the frames say so.
- Run `node build.mjs` after changing voice or footage. It regenerates all timing, so don't hand-edit index.html or compositions/.
