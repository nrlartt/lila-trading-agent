# Design Memory — LILA Trading Console

The dashboard ([public/index.html](public/index.html)) is a single static page served by Express.
No frontend framework; vanilla HTML/CSS/JS + Chart.js (only CDN dependency).

## Direction
- **Reference aesthetic:** Exchange / trading terminal (Bloomberg / Binance Pro). Data-first, tables, monospace numbers, hairline grid lines.
- **Density:** Comfortable (rows ~40px, 16px padding) — terminal structure without cramping.
- **Theme:** Light + dark with toggle. Initial theme from `localStorage('lila-theme')` else system preference, set before paint to avoid flash. `data-theme` on `<html>`.
- **Accent strategy:** Neutral grayscale UI; color reserved for meaning only — green = positive/BUY, red = negative/SELL. Single `--ring` blue for focus only.

## Tokens (CSS variables in `:root[data-theme=…]`)
- Surfaces: `--bg`, `--surface`, `--surface-2/3`; borders `--border`, `--border-strong`, `--grid`.
- Text: `--text`, `--text-2`, `--text-3`.
- Semantic: `--pos`/`--pos-bg`, `--neg`/`--neg-bg`, `--warn`/`--warn-bg`.
- Radius: `--r-sm 4 / --r-md 6 / --r-lg 8`. Spacing on an ~8px rhythm.

## Typography
- `--font-sans`: system stack. `--font-mono`: system mono stack (no web fonts).
- All numbers, addresses, tx hashes, log lines, and metric values use `.num` (`tabular-nums`) and/or `.mono`.

## Components
- **Top bar:** brand, mode pill (paper=green / live=red+pulse), wallet copy button, UTC clock, theme toggle (inline SVG sun/moon).
- **Stat strip:** 6 cells divided by 1px borders; label (uppercase caption) + mono value + sub.
- **Panels:** flat surfaces, 1px borders, uppercase panel titles; grid-gap layout uses border color as gap background.
- **Tables:** left-align text / right-align numbers (`.r`), sticky headers, row hover (no zebra).
- **Watchlist / trades / x402 / allowlist checker:** see classes `.watch-row`, `.trade-row`, `.x402`, `.field`.

## Motion & a11y
- Transitions 100–180ms `--ease` (ease-out cubic); explicit properties only (never `transition: all`).
- `prefers-reduced-motion` disables animation.
- `:focus-visible` 2px ring + offset; semantic `<header>/<main>/<section>`, real `<button>`s, `aria-label` on icon buttons, `aria-live` log.

## Backend data contract (do not break)
WebSocket (`INIT`/`UPDATE`) + `GET /api/stats` return: `mode`, `walletAddress`, `stats{currentValue,startingBalance,totalReturnUsd,totalReturnPct,winRate,wins,losses,trades[],history[]}`, `riskStatus{dailySpendUsd,maxDailyLimit}`, `watchlist[]`, `sentiment{narrativeSummary,tokens[]}`, `narrative`, `x402{enabled,paymentCount,lastPaidAt}`, `x402Earnings{enabled,priceUsd,network,payTo,requestsPaid,totalEarnedUsd,recent[]}`, `proof{length,root,verified,lastAnchor,anchors[],entries[]}`.

Extra endpoints: `GET /api/proof` (verifiable ledger), `GET /skill/market-read` (x402-gated alpha — 402 → pay → 200).

## Avoid (previous "AI-generated" look)
Glow orbs / blurred gradient spheres, glassmorphism + gradient borders, rainbow multi-accent palette, gradient/`-webkit-text-fill` text, shine/heartbeat decorations, FontAwesome + Google Fonts CDNs.
