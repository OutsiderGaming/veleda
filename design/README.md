# Veleda — design reference

Final style: **dark obsidian with copper**. The reskin options explored earlier are retired.

## Files

| File | What it is |
| --- | --- |
| `core-flow-overview.png` | All four screens side by side (export of the canvas) |
| `screens/1-timeline-month.png` | Market timeline, Month zoom level |
| `screens/2-dragging-a-window.png` | Selecting a window by dragging (Day zoom level) |
| `screens/3-buy-sheet.png` | Buy sheet |
| `screens/4-your-positions.png` | Positions screen with cash-out |
| `logo.png` | App mark: gold engraved seeress on dark green-black |
| `fonts/` | Cinzel and Manrope variable fonts (both SIL Open Font License, from Google Fonts) |
| `source/*.dc.html` | Mockup sources from the design canvas. They use a canvas-specific templating runtime (`<sc-for>`, `<sc-if>`, `{{holes}}`, a `DCLogic` class), so they won't open as plain HTML. Read them for exact layout, spacing and colour values; don't try to run them. |

Live canvas (owner only): https://claude.ai/artifact/AT3unoJ2sQ7hHadgNZWfih

## Tokens (as used in the mockups)

| Role | Value |
| --- | --- |
| Background | `#0D0F0E` |
| Sheet / card | `#151816` |
| Inset / segmented control | `#101311`, `#171A18` |
| Button (secondary) | `#1B1E1B`, border `#2E2B25` |
| Hairline border | `#2C2A24` |
| Selected chip background | `#2A221A` |
| Text primary | `#EDE4D6` |
| Text secondary | `#BFB5A5` |
| Text muted | `#8E8577` |
| Copper (accent, links, borders) | `#E9A867` |
| Copper light (multipliers, selected text) | `#F6C792` |
| Primary button | gradient `#F2BE84 → #D08D4B`, text `#1A120A` |
| Gain | `#9CCB8E` (always with ▲ and +) |
| Loss | `#E8907A` (always with ▼ and −) |

**Timeline bars:** square-ended, stippled copper. Unselected: dot texture over `linear-gradient(90deg, #7A4A22, #C48A50 30%, #E8B97E 50%, #C48A50 70%, #7A4A22)` at 50% opacity. Selected: brighter gradient `#C48A50 → #F0CB98 → #C48A50`, full opacity. Dot texture: `radial-gradient(circle, rgba(13,15,14,0.55) 0.7px, transparent 0.9px)` at `3px 3px`. Month view uses thicker, darker bars (`#3E2612 → #9A6A3C`) so the white month labels stay readable.

**Type:** Cinzel (600/700) for the wordmark, multipliers, headline money figures and the primary button; Manrope (400–800) for everything else.

## Screen notes

1. **Timeline (month).** Year / Month / Day / Hour tabs. In month view, about 8 thick bars are on screen, each a tappable button with the month name engraved on it; bar width = crowd odds; right column shows that month's multiplier and %. Year dividers where the year changes. "Now · N months up" marker at top.
2. **Dragging a window.** Day view: thin stippled bars, handles top and bottom of the selection, a floating tag showing days, % and multiplier. Hint: "Drag to the edge to keep scrolling / Release to see your price".
3. **Buy sheet.** Dates and length, big Cinzel multiplier, "Crowd odds 6.1% · payout after fees", stake chips (5 / 20 / 50 / Other), "Wins if it lands" (the app says "Win if it lands:"), detail line (shares · fee · cancels if price passes X%), primary button "predict the future │ 20 USDC" (the app shows VCR), then "Share this window as a link". No edit button: swipe the sheet down to return to the timeline. Decorative radiating copper lines in the top-right are clipped just below the stake chips.
4. **Your positions.** Hero total value in USDC (no label, no glow), then "▲ +P&L (%) · paid · N open". Open / Settled tabs. Each card: question, window in copper, LIVE P&L block with sparkline, Paid / Worth now (after 3.5% fee) / If it lands (with entry multiplier), entry vs current odds, full-width copper "cash out │ amount USDC" button. Locked state: greyed button with lock icon. The mockup copy "Locked · inside the final 72 hours" reads as the end of the window, so the app uses "Locked · within 72h of now". Bottom nav: Markets / Positions / Account.

## Known inconsistencies to resolve in the build

- Screen 1 is month view but screen 2 is day view, so the sequence jumps zoom level.
- The mockups show amounts in **USDC** as a placeholder. The demo uses our own devnet mint, Veleda Credit (VCR), with a "test money" label: the app shows "VCR" wherever the mockups show "USDC".
- **Multipliers ignore price impact.** The buy sheet's 316 shares and ×15.8 for 20 USDC are the flat-price figures. With the hackathon spec's flagship b = 1,000, 20 buys about 277 shares (×13.9). The app shows the real figure for the chosen stake.
- The "When will BTC first cross $200,000" card on screen 4 is decoration. That market is not in the hackathon spec.
- The flagship market uses daily atoms, so the app hides the Hour tab there.
- Positions are shown as a card list here; the design spec also describes positions as coloured bands on the timeline. Both can coexist.
- The mockups' demo market, "When will Taylor Swift's first child be born?", is the confirmed flagship question.
