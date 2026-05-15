# Snappy Services Google Reviews Archive

Snapshots of Google reviews pulled from Snappy Services' public business profile, used to seed the matrix Review Pay column ($15/review weekly) and the leaderboard GR★ lane (×5 no cap).

## Files

| File | Description |
|------|-------------|
| `snappy_reviews_YYYY-MM-DD.json` | Raw pulled reviews (date_rel, stars, reviewer, text) |
| `snappy_reviews_attributed_YYYY-MM-DD.json` | Reviews with per-tech attribution + week/MTD flags |
| `snappy_tallies_YYYY-MM-DD.json` | Final week/MTD counts per tech |

## Window rules (anchor date based)
- **Week**: Mon → Sat of anchor week (0–4 days ago + same week)
- **MTD**: May 1 onward (1–2 weeks ago included; 3+ weeks ago excluded)

## Attribution rules
- "James Bryant" → daniel (user-stated session rule)
- "Ben Johnson" mentions → DROPPED (different tech, electrical lane)
- Plain "Ben" mentions → benji
- "Demone"/"Demome" misspellings → dewone
- Reviewer-name false positives (Ben Frank, Benjamin Puckett, Nick Perino): credit text, not name

## Current snapshot: 2026-05-15
Decision: option_b_drop_ben_johnson
- Daniel: Week 5 / MTD 12
- Dewone: Week 2 / MTD 8
- Benji: Week 0 / MTD 4
- Nick: Week 2 / MTD 2
- Chris/Dee: 0 / 0
