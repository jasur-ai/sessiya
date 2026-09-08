# Deborah CVD Report (S06.08-09)

Generated: 2026-09-08T15:12:21.674Z
Distinctness checks: 67 | PASS: 46 | INFO (grayscale, qonuniy): 13 | Warnings: 8 | Hard FAIL: 0

## CVD simulation — status/answer distinctness (min Δ ≥ 30)

| Group | CVD | Pair | Δ | Min | Status |
|-------|-----|------|---|-----|--------|
| status | protanopia | success↔warning | 61.9 | 30 | PASS |
| status | protanopia | success↔danger | 67.8 | 30 | PASS |
| status | protanopia | success↔signal | 22.1 | 30 | FAIL |
| status | protanopia | success↔primary | 37.4 | 30 | PASS |
| status | protanopia | warning↔danger | 13.2 | 30 | FAIL |
| status | protanopia | warning↔signal | 78.4 | 30 | PASS |
| status | protanopia | warning↔primary | 93.4 | 30 | PASS |
| status | protanopia | danger↔signal | 81.5 | 30 | PASS |
| status | protanopia | danger↔primary | 95.8 | 30 | PASS |
| status | protanopia | signal↔primary | 15.7 | 30 | FAIL |
| status | deuteranopia | success↔warning | 78.5 | 30 | PASS |
| status | deuteranopia | success↔danger | 94.7 | 30 | PASS |
| status | deuteranopia | success↔signal | 21.9 | 30 | FAIL |
| status | deuteranopia | success↔primary | 31.2 | 30 | PASS |
| status | deuteranopia | warning↔danger | 19.9 | 30 | FAIL |
| status | deuteranopia | warning↔signal | 95.5 | 30 | PASS |
| status | deuteranopia | warning↔primary | 101.2 | 30 | PASS |
| status | deuteranopia | danger↔signal | 109.8 | 30 | PASS |
| status | deuteranopia | danger↔primary | 114.3 | 30 | PASS |
| status | deuteranopia | signal↔primary | 10.0 | 30 | FAIL |
| status | tritanopia | success↔warning | 81.8 | 30 | PASS |
| status | tritanopia | success↔danger | 98.6 | 30 | PASS |
| status | tritanopia | success↔signal | 38.6 | 30 | PASS |
| status | tritanopia | success↔primary | 47.5 | 30 | PASS |
| status | tritanopia | warning↔danger | 25.7 | 30 | FAIL |
| status | tritanopia | warning↔signal | 113.0 | 30 | PASS |
| status | tritanopia | warning↔primary | 114.0 | 30 | PASS |
| status | tritanopia | danger↔signal | 124.5 | 30 | PASS |
| status | tritanopia | danger↔primary | 122.5 | 30 | PASS |
| status | tritanopia | signal↔primary | 14.6 | 30 | FAIL |
| status | grayscale | success↔warning | 2.0 | 30 | INFO |
| status | grayscale | success↔danger | 12.0 | 30 | INFO |
| status | grayscale | success↔signal | 3.0 | 30 | INFO |
| status | grayscale | success↔primary | 26.0 | 30 | INFO |
| status | grayscale | warning↔danger | 14.0 | 30 | INFO |
| status | grayscale | warning↔signal | 1.0 | 30 | INFO |
| status | grayscale | warning↔primary | 28.0 | 30 | INFO |
| status | grayscale | danger↔signal | 15.0 | 30 | INFO |
| status | grayscale | danger↔primary | 14.0 | 30 | INFO |
| status | grayscale | signal↔primary | 29.0 | 30 | INFO |
| answers | protanopia | correct↔incorrect | 67.8 | 30 | PASS |
| answers | protanopia | correct↔selected | 37.4 | 30 | PASS |
| answers | protanopia | correct↔pending | 79.5 | 30 | PASS |
| answers | protanopia | incorrect↔selected | 95.8 | 30 | PASS |
| answers | protanopia | incorrect↔pending | 38.2 | 30 | PASS |
| answers | protanopia | selected↔pending | 93.6 | 30 | PASS |
| answers | deuteranopia | correct↔incorrect | 94.7 | 30 | PASS |
| answers | deuteranopia | correct↔selected | 31.2 | 30 | PASS |
| answers | deuteranopia | correct↔pending | 87.5 | 30 | PASS |
| answers | deuteranopia | incorrect↔selected | 114.3 | 30 | PASS |
| answers | deuteranopia | incorrect↔pending | 38.9 | 30 | PASS |
| answers | deuteranopia | selected↔pending | 97.0 | 30 | PASS |
| answers | tritanopia | correct↔incorrect | 98.6 | 30 | PASS |
| answers | tritanopia | correct↔selected | 47.5 | 30 | PASS |
| answers | tritanopia | correct↔pending | 85.1 | 30 | PASS |
| answers | tritanopia | incorrect↔selected | 122.5 | 30 | PASS |
| answers | tritanopia | incorrect↔pending | 95.2 | 30 | PASS |
| answers | tritanopia | selected↔pending | 63.1 | 30 | PASS |
| answers | grayscale | correct↔incorrect | 12.0 | 30 | INFO |
| answers | grayscale | correct↔selected | 26.0 | 30 | INFO |
| answers | grayscale | correct↔pending | 52.0 | 30 | PASS |
| answers | grayscale | incorrect↔selected | 14.0 | 30 | INFO |
| answers | grayscale | incorrect↔pending | 64.0 | 30 | PASS |
| answers | grayscale | selected↔pending | 78.0 | 30 | PASS |

### Confusable pairs (redundant encoding talab qiladi — S06.09)

- ⚠️ CVD protanopia: status.success vs status.signal — Δ=22.1 < 30 (redundant encoding talab qilinadi)
- ⚠️ CVD protanopia: status.warning vs status.danger — Δ=13.2 < 30 (redundant encoding talab qilinadi)
- ⚠️ CVD protanopia: status.signal vs status.primary — Δ=15.7 < 30 (redundant encoding talab qilinadi)
- ⚠️ CVD deuteranopia: status.success vs status.signal — Δ=21.9 < 30 (redundant encoding talab qilinadi)
- ⚠️ CVD deuteranopia: status.warning vs status.danger — Δ=19.9 < 30 (redundant encoding talab qilinadi)
- ⚠️ CVD deuteranopia: status.signal vs status.primary — Δ=10.0 < 30 (redundant encoding talab qilinadi)
- ⚠️ CVD tritanopia: status.warning vs status.danger — Δ=25.7 < 30 (redundant encoding talab qilinadi)
- ⚠️ CVD tritanopia: status.signal vs status.primary — Δ=14.6 < 30 (redundant encoding talab qilinadi)

## S06.09 Redundant encoding audit

- ✅ status badge: text label mavjud
- ✅ answer option: letter (A/B/C/D)
- ✅ focus-visible style (color emas, ring)

✅ Hard gate o'tdi: redundant encoding (status=color+icon+text, answer=color+shape+letter) mavjud — grayscale/CVD'da ham ma'no saqlanadi.
