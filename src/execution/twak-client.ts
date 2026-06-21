import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger';
import { config } from '../core/config';
import { 
  WalletAddress, 
  WalletPortfolio, 
  SwapQuote, 
  SwapResult, 
  CompetitionStatus,
  CompetitionRegisterResult
} from './types';
import { getTokenAddress, BSC_TOKEN_ADDRESSES } from '../config/eligible-tokens';

const execAsync = promisify(exec);

export class TwakClient {
  /**
   * Resolve a token symbol to the swap-router argument. BNB stays native; any token
   * with a known BSC contract address is passed as `0x...` (the TWAK router does not
   * resolve most symbols). Unknown symbols are passed through (and will fail loudly).
   */
  private resolveAsset(symbol: string): string {
    if (!symbol || symbol.toUpperCase() === 'BNB') return 'BNB';
    return getTokenAddress(symbol) || symbol;
  }

  private isInitialized = false;
  private decimalsCache: Record<string, number> = {};
  private cachedBscAddress?: string;

  // ---- On-chain (BSC RPC) helpers: TWAK's portfolio doesn't surface every BEP-20 we
  // hold (e.g. Binance-Peg tokens bought by address), so we read balances directly. ----

  private async rpc(method: string, params: any[]): Promise<any> {
    const res = await fetch(config.bscRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const j = (await res.json()) as any;
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  }

  private padAddress(addr: string): string {
    return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  }

  private async erc20Decimals(tokenAddr: string): Promise<number> {
    const key = tokenAddr.toLowerCase();
    if (this.decimalsCache[key] != null) return this.decimalsCache[key];
    try {
      const r = await this.rpc('eth_call', [{ to: tokenAddr, data: '0x313ce567' }, 'latest']);
      const d = parseInt(r, 16);
      this.decimalsCache[key] = Number.isFinite(d) && d > 0 && d <= 36 ? d : 18;
    } catch {
      this.decimalsCache[key] = 18;
    }
    return this.decimalsCache[key];
  }

  /** ERC-20 balance (human units) of a token contract for the agent wallet. */
  private async erc20Balance(tokenAddr: string, owner: string): Promise<number> {
    const data = '0x70a08231' + this.padAddress(owner);
    const r = await this.rpc('eth_call', [{ to: tokenAddr, data }, 'latest']);
    const raw = BigInt(r);
    if (raw === 0n) return 0;
    const dec = await this.erc20Decimals(tokenAddr);
    return Number(raw) / Math.pow(10, dec);
  }

  /** Cached BSC wallet address (avoids a slow CLI call on every balance read). */
  private async bscOwner(): Promise<string> {
    if (!this.cachedBscAddress) this.cachedBscAddress = await this.getAddress('bsc');
    return this.cachedBscAddress;
  }

  /**
   * True BSC portfolio valuation. Reads native BNB plus every token in our verified
   * address map directly from the chain, valuing each via a read-only quote to USDC.
   * This is the source of truth for portfolio value and drawdown — independent of
   * whether TWAK's own portfolio command happens to list a given token.
   */
  public async getBscValuation(): Promise<WalletPortfolio> {
    await this.init();
    const owner = await this.bscOwner();

    let nativeBalance = '0';
    let nativeUsd = 0;
    try {
      const balRaw = await this.runCli('wallet balance', ['--chain bsc', '--json']);
      const b = JSON.parse(balRaw);
      nativeBalance = String(b.total || b.available || '0');
      nativeUsd = Number(b.totalUsd) || 0;
    } catch {
      try {
        const r = await this.rpc('eth_getBalance', [owner, 'latest']);
        nativeBalance = (Number(BigInt(r)) / 1e18).toString();
      } catch { /* leave defaults */ }
    }

    const entries = Object.entries(BSC_TOKEN_ADDRESSES).filter(([s]) => s.toUpperCase() !== 'WBNB');
    const balances = await Promise.all(entries.map(async ([sym, addr]) => {
      try { return { sym, addr, bal: await this.erc20Balance(addr, owner) }; }
      catch { return { sym, addr, bal: 0 }; }
    }));

    const tokens: { symbol: string; balance: string; usdValue: number }[] = [];
    for (const { sym, addr, bal } of balances) {
      if (bal <= 0) continue;
      const dec = await this.erc20Decimals(addr);
      const usd = await this.valueTokenUsd(addr, bal, dec);
      tokens.push({ symbol: sym, balance: String(bal), usdValue: usd });
    }

    const totalUsdValue = nativeUsd + tokens.reduce((s, t) => s + (t.usdValue || 0), 0);
    return { chain: 'bsc', nativeBalance, nativeUsdValue: nativeUsd, tokens, totalUsdValue };
  }

  /** USD value of a token holding via a read-only swap quote to USDC. */
  private async valueTokenUsd(tokenAddr: string, amountHuman: number, dec: number): Promise<number> {
    if (amountHuman <= 0) return 0;
    try {
      const r = await this.runCli(
        `swap ${amountHuman} ${tokenAddr} ${config.usdcAddress}`,
        ['--chain bsc', `--decimals ${dec}`, '--quote-only', '--json']
      );
      const j = JSON.parse(r) as any;
      const out = parseFloat(String(j.output || '').split(' ')[0]);
      return Number.isFinite(out) ? out : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Helper to execute TWAK CLI command with loaded environment
   */
  private async runCli(command: string, args: string[] = []): Promise<string> {
    const fullCommand = `npx @trustwallet/cli ${command} ${args.join(' ')}`;
    
    // Merge TWAK credentials and password into child process environment
    const env = {
      ...process.env,
      TWAK_ACCESS_ID: config.twakAccessId,
      TWAK_HMAC_SECRET: config.twakHmacSecret,
      TWAK_WALLET_PASSWORD: config.twakWalletPassword || '',
      // Ensure color outputs are off for cleaner logs
      FORCE_COLOR: '0',
    };

    try {
      logger.debug(`Executing TWAK CLI: ${fullCommand}`);
      const { stdout, stderr } = await execAsync(fullCommand, { env });
      
      if (stderr && stderr.trim().length > 0 && !stderr.includes('npm warn')) {
        logger.warn(`TWAK CLI stderr: ${stderr.trim()}`);
      }
      
      return stdout.trim();
    } catch (error: any) {
      // The real failure reason from the CLI lives in stderr/stdout, not error.message.
      const parts = [error.stderr && error.stderr.trim(), error.stdout && error.stdout.trim()].filter(Boolean);
      const detail = parts.join(' || ') || error.message || 'unknown error';
      logger.error(`TWAK CLI execution failed: ${fullCommand}. ${detail}`);
      throw new Error(detail);
    }
  }

  /**
   * Initialize TWAK credentials
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('Initializing Trust Wallet Agent Kit CLI credentials...');
      // Credentials are provided via TWAK_ACCESS_ID / TWAK_HMAC_SECRET in the
      // child process env (see runCli). Passing them as CLI args would leak
      // secrets into shell history and the process list, so run `init` bare.
      await this.runCli('init');
      this.isInitialized = true;
      logger.info('Trust Wallet Agent Kit CLI credentials initialized successfully.');
    } catch (error: any) {
      logger.error(`Failed to initialize TWAK CLI: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a new agent wallet if one does not exist
   */
  public async createWalletIfNotExists(): Promise<void> {
    await this.init();
    try {
      logger.info('Checking wallet status...');
      const statusRaw = await this.runCli('wallet status');
      
      if (statusRaw.includes('No wallet configured') || statusRaw.includes('not configured')) {
        logger.info('No wallet found. Creating a new agent wallet...');
        
        // Use default password or a prompt. Here we use the password from configuration.
        if (!config.twakWalletPassword) {
          throw new Error('TWAK_WALLET_PASSWORD is required to create a wallet.');
        }

        // Password is provided via the TWAK_WALLET_PASSWORD env var (see runCli),
        // not as a CLI arg, to avoid leaking it into shell history / process list.
        const result = await this.runCli('wallet create');
        logger.info(`Agent wallet created successfully. Details: ${result}`);
      } else {
        logger.info('Agent wallet already exists and is configured.');
      }
    } catch (error: any) {
      logger.error(`Error in wallet setup: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get wallet address for BSC (or other chain)
   */
  public async getAddress(chain: string = 'bsc'): Promise<string> {
    await this.init();
    try {
      const result = await this.runCli('wallet address', [`--chain ${chain}`]);
      
      // Attempt to parse as JSON if applicable
      if (result.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(result);
          if (parsed.address) return parsed.address;
        } catch {}
      }

      // Robust regex lookup for 0x... address
      const addressMatch = result.match(/0x[a-fA-F0-9]{40}/);
      if (addressMatch) {
        return addressMatch[0];
      }
      
      // Fallback string cleaning if regex fails
      const lines = result.split('\n');
      const addressLine = lines.find(l => l.toLowerCase().includes('address') || l.startsWith('0x'));
      if (addressLine) {
        if (addressLine.trim().startsWith('0x')) return addressLine.trim();
        const splitMatch = addressLine.match(/0x[a-fA-F0-9]{40}/);
        if (splitMatch) return splitMatch[0];
      }
      
      return result.trim();
    } catch (error: any) {
      logger.error(`Failed to get address for chain ${chain}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reduce the TWAK CLI's multi-chain balance array to the BSC portfolio view.
   */
  private toBscPortfolio(entries: any[]): WalletPortfolio {
    const bsc = entries.filter(e => e.chain === 'bsc');
    const native = bsc.find(e => e.type === 'native' || (e.symbol || '').toUpperCase() === 'BNB');
    const tokens = bsc
      .filter(e => e !== native)
      .map(e => ({ symbol: e.symbol, balance: String(e.balance ?? '0'), usdValue: e.usdValue ?? 0 }));
    const totalUsdValue = bsc.reduce((sum, e) => sum + (Number(e.usdValue) || 0), 0);
    return {
      chain: 'bsc',
      nativeBalance: String(native?.balance ?? '0'),
      nativeBalanceRaw: native?.balanceRaw,
      nativeUsdValue: Number(native?.usdValue) || 0,
      tokens,
      totalUsdValue
    };
  }

  public async getPortfolio(): Promise<WalletPortfolio> {
    await this.init();
    try {
      // Wallet password is supplied via TWAK_WALLET_PASSWORD env (see runCli).
      const args = ['--json'];
      const result = await this.runCli('wallet portfolio', args);
      try {
        const parsed = JSON.parse(result);
        // The TWAK CLI returns a multi-chain array of balance entries; reduce it to
        // the BSC view this agent trades on. Also accept a pre-shaped object.
        if (Array.isArray(parsed)) {
          return this.toBscPortfolio(parsed);
        }
        return parsed as WalletPortfolio;
      } catch {
        logger.warn('Failed to parse portfolio output as JSON. Parsing raw text...');
        // Fallback mock portfolio for paper trading / testing if json output is not working
        return {
          chain: 'bsc',
          nativeBalance: '1.0',
          nativeBalanceRaw: '1000000000000000000',
          nativeUsdValue: 300,
          tokens: [],
          totalUsdValue: 300
        };
      }
    } catch (error: any) {
      logger.warn(`Failed to get portfolio: ${error.message}. Returning fallback portfolio.`);
      return {
        chain: 'bsc',
        nativeBalance: '1.0',
        nativeBalanceRaw: '1000000000000000000',
        nativeUsdValue: 300,
        tokens: [],
        totalUsdValue: 300
      };
    }
  }

  /**
   * Get swap quote from TWAK
   */
  public async getSwapQuote(
    fromToken: string, 
    toToken: string, 
    amountUsd: number, 
    chain: string = 'bsc'
  ): Promise<SwapQuote> {
    await this.init();
    try {
      const args = [
        `--chain ${chain}`,
        `--usd ${amountUsd}`,
        `--slippage ${config.slippageBps / 100}`,
        '--quote-only',
        '--json'
      ];
      const result = await this.runCli(`swap ${this.resolveAsset(fromToken)} ${this.resolveAsset(toToken)}`, args);
      return JSON.parse(result) as SwapQuote;
    } catch (error: any) {
      logger.error(`Failed to get swap quote: ${error.message}`);
      throw error;
    }
  }

  /**
   * Current on-chain balance (amount) of a symbol on BSC. Returns -1 if it can't be read.
   */
  private async getBscTokenBalance(symbol: string): Promise<number> {
    try {
      const owner = await this.bscOwner();
      if (symbol.toUpperCase() === 'BNB') {
        const r = await this.rpc('eth_getBalance', [owner, 'latest']);
        return Number(BigInt(r)) / 1e18;
      }
      const addr = getTokenAddress(symbol);
      if (addr) return await this.erc20Balance(addr, owner);
      // Unknown token without a known address: fall back to TWAK portfolio.
      const p = await this.getPortfolio();
      const t = (p.tokens || []).find(x => (x.symbol || '').toUpperCase() === symbol.toUpperCase());
      return t ? parseFloat(t.balance || '0') : 0;
    } catch {
      return -1;
    }
  }

  /**
   * Poll the destination balance briefly to confirm whether a swap actually executed
   * on-chain, even if the CLI reported an error. BSC blocks are ~3s, so a short poll
   * window reliably catches a landed swap.
   */
  private async verifySwapExecuted(toToken: string, beforeBal: number): Promise<{ executed: boolean; delta: number }> {
    if (beforeBal < 0) return { executed: false, delta: 0 };
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise(r => setTimeout(r, 5000));
      const now = await this.getBscTokenBalance(toToken);
      if (now > beforeBal + 1e-12) {
        return { executed: true, delta: now - beforeBal };
      }
    }
    return { executed: false, delta: 0 };
  }

  /**
   * Execute token swap
   */
  public async executeSwap(
    fromToken: string, 
    toToken: string, 
    amountUsd: number, 
    chain: string = 'bsc'
  ): Promise<SwapResult> {
    await this.init();
    try {
      if (config.agentMode === 'paper') {
        logger.info(`[PAPER TRADING] Simulating swap of $${amountUsd} worth of ${fromToken} for ${toToken} on ${chain}`);
        return {
          success: true,
          txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
          amountIn: amountUsd.toString(),
          amountOut: (amountUsd * 0.99).toString(), // Assume 1% fee/slippage
          fromToken,
          toToken
        };
      }

      logger.info(`[LIVE TRADING] Executing swap of $${amountUsd} worth of ${fromToken} for ${toToken} on ${chain}`);

      const args = [
        `--chain ${chain}`,
        `--usd ${amountUsd}`,
        `--slippage ${config.slippageBps / 100}`,
        '--json'
      ];
      // Snapshot the destination balance first. The TWAK CLI sometimes broadcasts the
      // swap successfully but still exits non-zero (e.g. confirmation timeout) without
      // printing a parseable result. We use the on-chain balance delta as the source of
      // truth so a successful swap is never mis-reported as a failure (which would
      // otherwise make the agent retry and double-spend).
      const beforeBal = await this.getBscTokenBalance(toToken);

      // Wallet password is supplied via TWAK_WALLET_PASSWORD env (see runCli).
      // Tokens are resolved to BSC contract addresses (the router needs 0x..., not symbols).
      try {
        const result = await this.runCli(`swap ${this.resolveAsset(fromToken)} ${this.resolveAsset(toToken)}`, args);
        const parsed = JSON.parse(result) as SwapResult;
        const txHash = (parsed as any).txHash || (parsed as any).transactionHash || (parsed as any).hash;
        logger.info(`Swap completed. Tx Hash: ${txHash}`);
        return {
          success: true,
          txHash,
          amountIn: (parsed as any).amountIn || amountUsd.toString(),
          amountOut: (parsed as any).amountOut || (parsed as any).output || '0',
          fromToken,
          toToken
        };
      } catch (cliError: any) {
        // CLI errored — but did the swap actually land? Verify via balance delta.
        const txInMsg = (cliError.message || '').match(/0x[a-fA-F0-9]{64}/);
        const verified = await this.verifySwapExecuted(toToken, beforeBal);
        if (verified.executed || txInMsg) {
          logger.warn(`Swap CLI exited with an error, but the swap DID execute on-chain (balance +${verified.delta}). Recording as success.`);
          return {
            success: true,
            txHash: txInMsg ? txInMsg[0] : 'executed-unconfirmed',
            amountIn: amountUsd.toString(),
            amountOut: String(verified.delta || '0'),
            fromToken,
            toToken
          };
        }
        logger.error(`Swap did not execute: ${cliError.message}`);
        return { success: false, amountIn: amountUsd.toString(), amountOut: '0', fromToken, toToken, error: cliError.message };
      }
    } catch (error: any) {
      logger.error(`Failed to execute swap: ${error.message}`);
      return {
        success: false,
        amountIn: amountUsd.toString(),
        amountOut: '0',
        fromToken,
        toToken,
        error: error.message
      };
    }
  }

  /**
   * Register agent wallet for BNB Hack competition
   */
  public async registerCompetition(): Promise<CompetitionRegisterResult> {
    await this.init();
    try {
      logger.info('Registering agent for BNB Hack Competition on-chain...');
      // Wallet password is supplied via TWAK_WALLET_PASSWORD env (see runCli).
      const args = ['--json'];

      const result = await this.runCli('compete register', args);
      const parsed = JSON.parse(result) as CompetitionRegisterResult;
      logger.info(`Agent registered for competition successfully. Tx: ${parsed.txHash}`);
      return parsed;
    } catch (error: any) {
      logger.error(`Failed to register for BNB Hack competition: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check BNB Hack competition registration status
   */
  public async checkCompetitionStatus(): Promise<CompetitionStatus> {
    await this.init();
    try {
      const result = await this.runCli('compete status', ['--json']);
      const parsed = JSON.parse(result) as CompetitionStatus;
      logger.info(`Competition status: registered=${parsed.registered}`);
      return parsed;
    } catch (error: any) {
      logger.error(`Failed to check competition status: ${error.message}`);
      return {
        registered: false,
        error: error.message
      };
    }
  }

  /**
   * Anchor a decision-ledger root hash on-chain via the agent's ERC-8004 identity.
   * This commits LILA's tamper-evident track record so it can be independently verified.
   * Paper mode returns a simulated tx hash; live mode submits an on-chain attestation.
   */
  public async anchorProof(rootHash: string): Promise<string> {
    if (config.agentMode === 'paper') {
      const tx = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      logger.info(`[PAPER MODE] Simulating ERC-8004 proof anchor for root ${rootHash.slice(0, 12)}… Tx: ${tx}`);
      return tx;
    }
    await this.init();
    const args = [
      `--chain bsc`,
      `--metadata "lila.proof.root=${rootHash}"`,
      `--metadata "lila.proof.ts=${new Date().toISOString()}"`
    ];
    // Wallet password is supplied via TWAK_WALLET_PASSWORD env (see runCli).
    const result = await this.runCli('erc8004 attest', args);
    const txMatch = result.match(/0x[a-fA-F0-9]{64}/);
    return txMatch ? txMatch[0] : result.trim();
  }

  /**
   * Mint ERC-8004 Agent Identity on-chain
   */
  public async registerErc8004Identity(name: string, metadataUri: string): Promise<string> {
    await this.init();
    try {
      logger.info(`Registering ERC-8004 identity on BSC for agent: ${name}`);
      const args = [
        `--chain bsc`,
        `--uri "${metadataUri}"`,
        `--metadata "name=${name}"`,
        `--metadata "description=News Impact AI Trading Agent LILA"`
      ];
      // Wallet password is supplied via TWAK_WALLET_PASSWORD env (see runCli).
      const result = await this.runCli('erc8004 register', args);
      logger.info(`ERC-8004 Identity registered successfully: ${result}`);
      return result;
    } catch (error: any) {
      logger.error(`Failed to register ERC-8004 Identity: ${error.message}`);
      throw error;
    }
  }
}
