import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger';
import { config } from '../core/config';

const execAsync = promisify(exec);

export interface X402Status {
  enabled: boolean;
  paymentCount: number;
  lastEndpoint?: string;
  lastPaidAt?: string;
  lastError?: string;
}

export interface PremiumIntelligence {
  sentiment: number;        // -1.0 .. 1.0 boost signal
  fearAndGreed: number;     // 0 .. 100
  summary: string;
  paid: boolean;            // whether an x402 micropayment was made/simulated
  source: string;
}

export class X402Client {
  private status: X402Status = { enabled: config.x402Enabled, paymentCount: 0 };

  /**
   * Pay (via x402) for a premium intelligence feed and fold it into the trade loop.
   * In paper mode the payment + response are simulated; in live mode TWAK auto-signs
   * the USDC (EIP-3009) micropayment when the endpoint returns HTTP 402.
   */
  public async fetchPremiumIntelligence(): Promise<PremiumIntelligence> {
    if (!config.x402Enabled) {
      return { sentiment: 0, fearAndGreed: 50, summary: 'x402 disabled.', paid: false, source: 'disabled' };
    }

    const endpoint = config.x402DataEndpoint || 'https://intel.lilagent.xyz/x402/market-sentiment';
    this.status.lastEndpoint = endpoint;

    try {
      const res = await this.request(endpoint, 'GET');
      const data = res?.data || res || {};
      this.status.paymentCount += 1;
      this.status.lastPaidAt = new Date().toISOString();
      this.status.lastError = undefined;
      return {
        sentiment: typeof data.sentiment === 'number' ? (data.sentiment - 0.5) * 2 : 0,
        fearAndGreed: typeof data.fearAndGreed === 'number' ? data.fearAndGreed : 50,
        summary: data.summary || 'Premium intelligence retrieved via x402.',
        paid: true,
        source: config.agentMode === 'paper' ? 'x402-simulated' : 'x402-live'
      };
    } catch (error: any) {
      this.status.lastError = error.message;
      logger.warn(`x402 premium intelligence unavailable: ${error.message}. Continuing without boost.`);
      return { sentiment: 0, fearAndGreed: 50, summary: 'x402 feed unavailable.', paid: false, source: 'error' };
    }
  }

  /**
   * Snapshot of x402 usage for the dashboard / judges.
   */
  public getStatus(): X402Status {
    this.status.enabled = config.x402Enabled;
    return { ...this.status };
  }

  /**
   * Make a request to an x402-gated endpoint.
   * If the endpoint requires payment, the TWAK CLI will sign the payment authorization automatically.
   */
  public async request(
    url: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any,
    customHeaders: Record<string, string> = {}
  ): Promise<any> {
    if (config.agentMode === 'paper') {
      logger.info(`[PAPER MODE] Simulating x402 request to ${url} (${method})`);
      // Mock response depending on the url
      if (url.includes('sentiment') || url.includes('market')) {
        return {
          status: 'success',
          data: {
            sentiment: 0.65,
            fearAndGreed: 58,
            summary: 'BTC is testing key resistance at $68k. Volume is increasing.'
          }
        };
      }
      return { success: true, simulated: true };
    }

    try {
      logger.info(`Sending paid x402 request to ${url}`);
      
      const args = [
        `--method ${method}`,
      ];

      // Add body if present
      if (body) {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        // Escape quotes for Windows/Unix compatibility
        const escapedBody = bodyStr.replace(/"/g, '\\"');
        args.push(`--data "${escapedBody}"`);
      }

      // Add headers
      const headers = {
        'Content-Type': 'application/json',
        ...customHeaders
      };

      for (const [key, val] of Object.entries(headers)) {
        args.push(`-H "${key}: ${val}"`);
      }

      args.push('--json');

      const fullCommand = `npx @trustwallet/cli x402 request "${url}" ${args.join(' ')}`;
      const env = {
        ...process.env,
        TWAK_ACCESS_ID: config.twakAccessId,
        TWAK_HMAC_SECRET: config.twakHmacSecret,
        TWAK_WALLET_PASSWORD: config.twakWalletPassword || '',
        FORCE_COLOR: '0'
      };

      const { stdout } = await execAsync(fullCommand, { env });
      try {
        return JSON.parse(stdout.trim());
      } catch {
        logger.warn(`Response from x402 request is not JSON: ${stdout.trim()}`);
        return { raw: stdout.trim() };
      }
    } catch (error: any) {
      logger.error(`Failed x402 request to ${url}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check status of x402 integration
   */
  public async getInfo(): Promise<string> {
    try {
      const env = {
        ...process.env,
        TWAK_ACCESS_ID: config.twakAccessId,
        TWAK_HMAC_SECRET: config.twakHmacSecret,
        FORCE_COLOR: '0'
      };
      const { stdout } = await execAsync('npx @trustwallet/cli x402 info', { env });
      return stdout.trim();
    } catch (error: any) {
      logger.error(`Failed to get x402 info: ${error.message}`);
      return `Error: ${error.message}`;
    }
  }
}
