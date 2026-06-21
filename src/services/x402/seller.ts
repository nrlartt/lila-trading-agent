import { logger } from '../../core/logger';
import { config } from '../../core/config';

/**
 * x402 "seller" side — Alpha-as-a-Service.
 *
 * LILA exposes its fused market intelligence behind an x402 paywall. Other agents
 * (or MCP clients) that want LILA's alpha must pay a USDC micropayment per request,
 * turning the agent into a self-funding economic actor: it both *spends* via x402
 * (premium data) and *earns* via x402 (selling signal).
 *
 * The flow follows the x402 spec:
 *   1. No `X-PAYMENT` header  -> HTTP 402 with an `accepts` payment-requirements array.
 *   2. `X-PAYMENT` header     -> verify + settle, return 200 + `X-PAYMENT-RESPONSE`.
 *
 * In paper mode (or without a facilitator) settlement is simulated so the endpoint
 * is fully demoable offline; in live mode it delegates to an x402 facilitator.
 */

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string; // atomic units
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

export interface PaymentSettlement {
  ok: boolean;
  txHash?: string;
  payer?: string;
  amountUsd?: number;
  network?: string;
  error?: string;
}

export interface SaleRecord {
  at: string;
  payer: string;
  amountUsd: number;
  txHash: string;
  resource: string;
}

export interface X402Earnings {
  enabled: boolean;
  priceUsd: number;
  asset: string;
  network: string;
  payTo?: string;
  requestsPaid: number;
  requests402: number;
  totalEarnedUsd: number;
  recent: SaleRecord[];
}

export class X402Seller {
  private payTo?: string;
  private requestsPaid = 0;
  private requests402 = 0;
  private totalEarnedUsd = 0;
  private recent: SaleRecord[] = [];

  public setPayToAddress(address?: string): void {
    this.payTo = address;
  }

  private atomicAmount(): string {
    const amount = config.x402SellPriceUsd * Math.pow(10, config.usdcDecimals);
    return BigInt(Math.round(amount)).toString();
  }

  /**
   * Build the HTTP 402 payment-requirements body for a resource path.
   */
  public buildPaymentRequired(resourcePath: string): { status: 402; body: any } {
    this.requests402 += 1;
    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: config.x402Network,
      maxAmountRequired: this.atomicAmount(),
      resource: `${config.publicBaseUrl}${resourcePath}`,
      description: 'LILA fused market intelligence — CMC multi-factor read, watchlist & sentiment.',
      mimeType: 'application/json',
      payTo: this.payTo || '0x0000000000000000000000000000000000000000',
      maxTimeoutSeconds: 60,
      asset: config.usdcAddress,
      extra: { name: 'USD Coin', version: '2' }
    };

    return {
      status: 402,
      body: {
        x402Version: 1,
        error: 'X-PAYMENT header is required to access LILA alpha.',
        accepts: [requirements]
      }
    };
  }

  /**
   * Verify and settle a payment presented in the `X-PAYMENT` header.
   * Returns a settlement result; on success the caller is granted the resource.
   */
  public async settle(paymentHeader: string, resourcePath: string): Promise<PaymentSettlement> {
    let payer = 'unknown';
    try {
      const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
      payer = decoded?.payload?.authorization?.from || decoded?.from || 'unknown';
    } catch {
      // Header may not be base64-JSON in simulated calls; tolerate it.
    }

    // Live settlement via facilitator (if configured).
    if (config.agentMode === 'live' && config.x402FacilitatorUrl) {
      try {
        const res = await fetch(`${config.x402FacilitatorUrl.replace(/\/$/, '')}/settle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentHeader,
            network: config.x402Network,
            payTo: this.payTo,
            asset: config.usdcAddress,
            maxAmountRequired: this.atomicAmount()
          })
        });
        if (!res.ok) throw new Error(`facilitator HTTP ${res.status}`);
        const data = (await res.json()) as any;
        if (!data.success) throw new Error(data.error || 'settlement rejected');
        return this.record(resourcePath, data.payer || payer, data.transaction);
      } catch (error: any) {
        logger.warn(`x402 settle (facilitator) failed: ${error.message}`);
        return { ok: false, error: error.message, network: config.x402Network };
      }
    }

    // Simulated settlement (paper / no facilitator).
    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    logger.info(`[x402 SELL] Settled simulated payment from ${payer} for $${config.x402SellPriceUsd} (${resourcePath}).`);
    return this.record(resourcePath, payer, txHash);
  }

  private record(resourcePath: string, payer: string, txHash: string): PaymentSettlement {
    this.requestsPaid += 1;
    this.totalEarnedUsd += config.x402SellPriceUsd;
    const sale: SaleRecord = {
      at: new Date().toISOString(),
      payer,
      amountUsd: config.x402SellPriceUsd,
      txHash,
      resource: resourcePath
    };
    this.recent.unshift(sale);
    if (this.recent.length > 25) this.recent.pop();
    return {
      ok: true,
      txHash,
      payer,
      amountUsd: config.x402SellPriceUsd,
      network: config.x402Network
    };
  }

  public getEarnings(): X402Earnings {
    return {
      enabled: config.x402SellEnabled,
      priceUsd: config.x402SellPriceUsd,
      asset: config.usdcAddress,
      network: config.x402Network,
      payTo: this.payTo,
      requestsPaid: this.requestsPaid,
      requests402: this.requests402,
      totalEarnedUsd: this.totalEarnedUsd,
      recent: this.recent.slice(0, 8)
    };
  }
}
