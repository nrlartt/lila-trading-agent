# LILA — Self-Funding & Verifiable Trading Agent

> **An autonomous trading agent that earns, proves, and trades — on BNB Smart Chain.**
> Powered by the **Trust Wallet Agent Kit (TWAK)**, **CoinMarketCap AI Agent Hub**, and **Groq LLM**.
> Live dashboard & on-chain proof at [lilagent.xyz](https://lilagent.xyz)

---

## ⚡️ What makes LILA different

Most trading agents do the same thing: read data → ask an LLM "bullish or bearish?" → swap →
add guardrails. LILA goes further and becomes an **autonomous economic actor**:

1. **Self-funding via two-way x402** — LILA doesn't just *spend* x402 micropayments to buy premium
   intelligence; it *earns* them by selling its own fused market read behind an x402 paywall
   (`GET /skill/market-read`). The same engine powers a **trade loop** and a **paid Strategy Skill**.
2. **Verifiable track record (ERC-8004)** — every decision is appended to a tamper-evident,
   hash-linked ledger whose root is anchored on-chain. Anyone can recompute the chain from the public
   log (`GET /api/proof`) and check it against the anchor. Reputation that is *proven*, not claimed.
3. **Multi-factor CMC intelligence** — connects to the CoinMarketCap AI Agent Hub over Streamable
   HTTP and fuses global metrics, trending narratives and news into a single market read, scored by Groq.
4. **Self-custody execution** — all signing happens locally through TWAK; private keys never leave the machine.

> One-liner: **LILA trades the alpha it produces, sells that same alpha via x402 to fund itself, and
> proves every decision on-chain.**

### Sponsor coverage

| Capability | LILA implementation |
|---|---|
| **TWAK execution depth** | All swaps, gas, portfolio & wallet ops go through the TWAK CLI; local AES-encrypted wallet (`~/.twak`). |
| **Native x402 (both directions)** | Consumes paid intel **and** sells its own alpha for USDC micropayments (full 402 → settle flow). |
| **CoinMarketCap AI Agent Hub** | Streamable-HTTP MCP client; multi-tool fusion with graceful fallback. |
| **BNB Chain + ERC-8004** | Self-custody trading on BSC; ERC-8004 identity + on-chain anchoring of the decision ledger. |
| **Autonomous guardrails** | 10% max drawdown, $5/trade, $10/day, 100 bps slippage, allowlist, dust protection. |
| **Two tracks** | *Autonomous Trading Agent* (the loop) **and** *Strategy Skills* (the x402 alpha endpoint). |

---

## 🏗️ Architecture

```
                  ┌───────────────────────────────┐
                  │  CoinMarketCap AI Agent Hub    │
                  │  (Streamable HTTP MCP)         │
                  └───────────────┬───────────────┘
                                  │ market read (multi-tool fusion)
                                  ▼
   ┌───────────────┐    ┌───────────────────────────────┐    ┌─────────────────┐
   │   Groq LLM    │◀──▶│       LILA Orchestrator        │◀──▶│  Risk Manager   │
   │ (sentiment)   │    │       (core event loop)        │    │  (guardrails)   │
   └───────────────┘    └───┬───────────┬───────────┬────┘    └─────────────────┘
                            │           │           │
        x402 (consume)──────┘           │           └──────decision records
        premium intel                   │                           │
                                        ▼                           ▼
                          ┌──────────────────────┐    ┌──────────────────────────┐
                          │  TWAK (execution)     │    │  Decision Ledger          │
                          │  - self-custody sign  │    │  - hash-linked chain      │
                          │  - PancakeSwap swaps  │    │  - on-chain anchor (8004) │
                          │  - x402 settle        │    │  - /api/proof verify      │
                          └───────────┬──────────┘    └──────────────────────────┘
                                      ▼
                            BNB Smart Chain (BSC)

   Alpha-as-a-Service:  other agents ──x402 pay──▶  GET /skill/market-read  ──▶  LILA alpha
```

---

## 🌐 HTTP surface

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /` | — | Live dashboard (light/dark terminal UI). |
| `GET /api/health` | — | Liveness + mode. |
| `GET /api/stats` | — | Full dashboard snapshot (stats, risk, watchlist, x402, proof). |
| `GET /api/proof` | — | Verifiable decision ledger (chain, root, anchors) — independently checkable. |
| `GET /skill/market-read` | **x402** | LILA's fused alpha. Returns **402** with payment requirements; pays via `X-PAYMENT` → **200** + alpha. |
| `WS /` | — | Real-time push of every cycle to the dashboard. |

### Consuming the paid alpha (x402)

```bash
# 1. Discover the price (returns HTTP 402 + payment requirements)
curl -i http://localhost:3000/skill/market-read

# 2. Pay & consume (x402 client / TWAK builds the X-PAYMENT header, then:)
curl -H "X-PAYMENT: <base64-payment-payload>" http://localhost:3000/skill/market-read
```

---

## 🛠️ Installation & setup

### Prerequisites
- Node.js 18+
- npm

### 1. Install
```bash
git clone https://github.com/yourusername/lila-trading-agent.git
cd lila-trading-agent
npm install
```

### 2. Configure
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

Key parameters:

**Core**
- `TWAK_ACCESS_ID` / `TWAK_HMAC_SECRET` — [Trust Wallet Developer Portal](https://portal.trustwallet.com).
- `TWAK_WALLET_PASSWORD` — encrypts the local wallet (required in live mode).
- `GROQ_API_KEY` / `GROQ_MODEL` — Groq LLM inference.
- `CMC_MCP_API_KEY` — [CoinMarketCap AI Agent Hub](https://pro.coinmarketcap.com) (sent as `X-CMC-MCP-API-KEY`).
- `CMC_MCP_URL` — defaults to `https://mcp.coinmarketcap.com/mcp`.
- `AGENT_MODE` — `paper` (simulation) or `live` (real on-chain trading).

**Risk / competition**
- `STARTING_BALANCE_USD=10`, `MAX_DRAWDOWN_PCT=10`, `DAILY_LIMIT_USD=10`, `MAX_TRADE_USD=5`, `SLIPPAGE_BPS=100`.

**x402 — consumer (buy intel)**
- `X402_ENABLED=true`, `X402_DATA_ENDPOINT` (optional; blank uses the built-in simulated premium feed).

**x402 — seller (sell alpha / Alpha-as-a-Service)**
- `X402_SELL_ENABLED=true`, `X402_SELL_PRICE_USD=0.01`, `X402_NETWORK=bsc`.
- `USDC_ADDRESS` / `USDC_DECIMALS` — settlement asset on BSC.
- `X402_FACILITATOR_URL` — optional facilitator for live verify/settle (blank = simulated in paper).
- `PUBLIC_BASE_URL` — base URL advertised in payment requirements.

> **Secrets:** credentials are passed to the TWAK CLI via environment variables only — never as CLI
> arguments — so they don't leak into shell history or the process list. Nothing secret is hard-coded.

---

## 🚀 Usage

### 1. On-chain registration & setup
Initializes the TWAK wallet, (in live mode) registers for the competition and the ERC-8004 identity:
```bash
npm run dev          # registration runs automatically on boot
```
*Fund the displayed BSC address with BNB (gas) + USDC/WBNB before running in live mode.*

### 2. Run the agent & dashboard
```bash
npm run dev          # ts-node (development)
# or
npm run build && npm start    # compiled (production)
```
Open [http://localhost:3000](http://localhost:3000) for the live dashboard: portfolio, equity curve,
decision log, holdings, CMC watchlist, the **x402 self-funding economy**, the **Alpha-as-a-Service**
endpoint, and the **verifiable track record**.

### 3. Tests
```bash
npm run test:tokens   # eligible BEP-20 allowlist filtering
npm run test:risk     # drawdown, trade sizing, spend-cap enforcement
```

---

## 🛡️ Risk management & guardrails
Enforced at the code level ([src/risk/risk-manager.ts](src/risk/risk-manager.ts)):
1. **Allowlist enforcer** — only approved BEP-20 tokens can be traded.
2. **Max sizing** — $5 per trade.
3. **Daily limit** — $10 cumulative per day.
4. **Drawdown halt** — stops buying on a 10% drawdown from the starting balance.
5. **Daily-activity enforcer** — guarantees ≥ 1 trade/day to stay qualified.
6. **Dust protection** — never lets portfolio value drop below $1.00.

---

## 🔎 Verifying the track record
The decision ledger ([src/agent/decision-ledger.ts](src/agent/decision-ledger.ts)) is a SHA-256
hash-linked chain: each entry commits to the previous entry's hash. `GET /api/proof` returns the chain,
its root, and the on-chain anchor transactions. Recompute the hashes from the entries and confirm the
root matches the anchored value — if a single past decision were altered, the chain would break.

> In **paper** mode, x402 settlement and on-chain anchoring are simulated so the full system is demoable
> offline. In **live** mode they execute through TWAK (settlement via facilitator, anchoring via ERC-8004).

---

## 📜 License
MIT License.
