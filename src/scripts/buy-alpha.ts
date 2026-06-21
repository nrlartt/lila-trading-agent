/**
 * Demo: act as another agent buying LILA's alpha over x402.
 *
 * Demonstrates the full "self-funding economy" loop end-to-end:
 *   1. Request the resource with no payment   -> HTTP 402 + payment requirements
 *   2. Build an X-PAYMENT authorization        -> (here a demo payload; live: TWAK signs EIP-3009)
 *   3. Re-request with X-PAYMENT               -> HTTP 200 + LILA's fused alpha
 *
 * Usage: npm run demo:x402   (server must be running, e.g. `npm run dev`)
 */

const BASE = process.env.LILA_BASE_URL || 'http://localhost:3000';
const RESOURCE = '/skill/market-read';

async function main() {
  console.log(`\n=== LILA Alpha-as-a-Service demo (buyer agent) ===`);
  console.log(`Target: ${BASE}${RESOURCE}\n`);

  // 1. Discover the price (expect 402)
  const probe = await fetch(`${BASE}${RESOURCE}`);
  if (probe.status !== 402) {
    console.error(`Expected HTTP 402, got ${probe.status}. Is the server running with X402_SELL_ENABLED=true?`);
    process.exit(1);
  }
  const reqs = (await probe.json()) as any;
  const accept = reqs.accepts[0];
  const human = Number(accept.maxAmountRequired) / Math.pow(10, 18);
  console.log(`[402] Payment required:`);
  console.log(`      price   : ${human} USDC  (${accept.maxAmountRequired} atomic)`);
  console.log(`      network : ${accept.network}`);
  console.log(`      payTo   : ${accept.payTo}`);
  console.log(`      asset   : ${accept.asset}\n`);

  // 2. Build a payment authorization. In live mode a real x402 client / TWAK signs an
  //    EIP-3009 USDC transfer authorization; here we present a demo authorization payload.
  const payment = Buffer.from(JSON.stringify({
    x402Version: 1,
    scheme: accept.scheme,
    network: accept.network,
    payload: {
      authorization: {
        from: '0xDEMOBuyerAgent000000000000000000000000001',
        to: accept.payTo,
        value: accept.maxAmountRequired,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 60),
        nonce: '0x' + Date.now().toString(16)
      }
    }
  })).toString('base64');

  // 3. Pay & consume (expect 200)
  const paid = await fetch(`${BASE}${RESOURCE}`, { headers: { 'X-PAYMENT': payment } });
  if (paid.status !== 200) {
    console.error(`Payment failed: HTTP ${paid.status}`);
    process.exit(1);
  }
  const settleHeader = paid.headers.get('X-PAYMENT-RESPONSE');
  const body = (await paid.json()) as any;

  console.log(`[200] Payment settled ✅`);
  if (settleHeader) {
    const settle = JSON.parse(Buffer.from(settleHeader, 'base64').toString('utf8'));
    console.log(`      tx      : ${settle.transaction}`);
    console.log(`      payer   : ${settle.payer}\n`);
  }

  console.log(`=== LILA alpha received ===`);
  const a = body.data || {};
  console.log(`regime    : ${a.regime}`);
  console.log(`composite : ${a.compositeScore}`);
  console.log(`sentiment : ${a.overallSentiment}`);
  console.log(`narrative : ${a.narrative}`);
  console.log(`watchlist : ${(a.watchlist || []).map((w: any) => `${w.symbol}(${w.score})`).join(', ')}`);
  console.log(`\n${a.disclaimer || ''}\n`);
}

main().catch((e) => { console.error('Demo failed:', e.message); process.exit(1); });
