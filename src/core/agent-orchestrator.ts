import { logger } from './logger';
import { config } from './config';
import { TwakClient } from '../execution/twak-client';
import { X402Client, X402Status } from '../execution/x402-client';
import { CmcSkillHubClient } from '../services/cmc/skill-hub-client';
import { SentimentAnalyzer } from '../agent/sentiment-analyzer';
import { StrategyEngine } from '../agent/strategy-engine';
import { DailyTradeEnforcer } from '../agent/daily-trade-enforcer';
import { DecisionLedger } from '../agent/decision-ledger';
import { X402Seller, PaymentSettlement } from '../services/x402/seller';
import { RiskManager } from '../risk/risk-manager';
import { PortfolioTracker } from '../risk/portfolio-tracker';
import { MarketContext, TradeDecision, MarketSentiment } from '../agent/types';
import { WatchlistCandidate, DailyMarketOverviewData } from '../services/cmc/types';
import { WalletPortfolio } from '../execution/types';
import { getRoutableUniverse } from '../config/eligible-tokens';

export class AgentOrchestrator {
  private twakClient: TwakClient;
  private x402Client: X402Client;
  private cmcClient: CmcSkillHubClient;
  private sentimentAnalyzer: SentimentAnalyzer;
  private strategyEngine: StrategyEngine;
  private tradeEnforcer: DailyTradeEnforcer;
  private riskManager: RiskManager;
  private portfolioTracker: PortfolioTracker;
  private ledger: DecisionLedger;
  private seller: X402Seller;

  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private isProcessing = false;
  private walletAddress?: string;

  // Latest intelligence snapshot surfaced to the dashboard
  private lastWatchlist: WatchlistCandidate[] = [];
  private lastSentiment?: MarketSentiment;
  private lastNarrative?: string;
  private lastX402?: X402Status;
  private lastAlpha?: any;
  private lastPortfolio?: WalletPortfolio;
  private universeOffset = 0; // rotating cursor over the tradable universe

  // Callback for WebSocket updates to the dashboard
  private onUpdateCallback?: (data: any) => void;

  constructor() {
    this.twakClient = new TwakClient();
    this.x402Client = new X402Client();
    this.cmcClient = new CmcSkillHubClient();
    this.sentimentAnalyzer = new SentimentAnalyzer();
    this.strategyEngine = new StrategyEngine();
    this.tradeEnforcer = new DailyTradeEnforcer();
    this.riskManager = new RiskManager();
    this.portfolioTracker = new PortfolioTracker();
    this.ledger = new DecisionLedger();
    this.seller = new X402Seller();
  }

  /**
   * Set callback for real-time dashboard updates
   */
  public onUpdate(callback: (data: any) => void): void {
    this.onUpdateCallback = callback;
  }

  /**
   * Start the orchestrator event loop
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    
    logger.info(`Starting LILA orchestrator. Mode: ${config.agentMode}. Interval: ${config.tradeIntervalMs / 1000}s`);
    
    // Initialize clients and wallets
    await this.twakClient.createWalletIfNotExists();
    this.walletAddress = await this.twakClient.getAddress('bsc');
    this.seller.setPayToAddress(this.walletAddress);
    await this.cmcClient.connect();

    this.isRunning = true;
    
    // Run initial tick immediately
    await this.tick();

    // Schedule subsequent ticks
    this.intervalId = setInterval(() => this.tick(), config.tradeIntervalMs);
  }

  /**
   * Stop the orchestrator event loop
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    logger.info('Stopping LILA orchestrator...');
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    await this.cmcClient.disconnect();
    this.isRunning = false;
    logger.info('LILA orchestrator stopped.');
  }

  /**
   * Main orchestrator loop iteration
   */
  public async tick(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('Previous tick is still processing. Skipping this cycle.');
      return;
    }

    this.isProcessing = true;
    logger.info('--- Beginning LILA Cycle ---');

    try {
      // 1. Fetch current portfolio and balances (true on-chain valuation, including
      // tokens TWAK's own portfolio doesn't surface) and cache it for the dashboard.
      const portfolio = config.agentMode === 'live'
        ? await this.twakClient.getBscValuation()
        : await this.twakClient.getPortfolio();
      this.lastPortfolio = portfolio;
      this.portfolioTracker.recordSnapshot(portfolio);

      const currentBalanceUsd = portfolio.totalUsdValue || config.startingBalanceUsd;
      logger.info(`Current Portfolio Value: $${currentBalanceUsd.toFixed(2)}`);

      // Resolve open positions
      const openPositions: Record<string, number> = {};
      openPositions['BNB'] = parseFloat(portfolio.nativeBalance);
      if (portfolio.tokens) {
        portfolio.tokens.forEach(t => {
          openPositions[t.symbol.toUpperCase()] = parseFloat(t.balance);
        });
      }

      // 2. Fetch market reports from CMC AI Agent Hub
      const marketOverview = await this.cmcClient.getDailyMarketOverview(true);

      // 2b. Broaden the candidate set: scan a rotating slice of the full eligible
      // universe (momentum-ranked) instead of only the daily-overview watchlist.
      marketOverview.watchlist = await this.buildCandidateUniverse(marketOverview.watchlist || []);
      logger.info(`Candidate universe this cycle: ${marketOverview.watchlist.map(w => w.symbol).join(', ')}`);

      // 3. Pay (via x402) for a premium intelligence feed and fold it into the loop
      const premium = await this.x402Client.fetchPremiumIntelligence();
      this.lastX402 = this.x402Client.getStatus();
      if (premium.paid) {
        logger.info(`x402 premium intelligence acquired (Fear&Greed: ${premium.fearAndGreed}, boost: ${premium.sentiment.toFixed(2)}). ${premium.summary}`);
      }

      // 4. Run AI sentiment analysis on the data using Groq
      const sentiment = await this.sentimentAnalyzer.analyze(marketOverview);

      // Blend the x402 premium sentiment signal into the overall read
      if (premium.paid) {
        sentiment.overallScore = Math.max(-1, Math.min(1, (sentiment.overallScore + premium.sentiment) / 2));
        sentiment.narrativeSummary = `${sentiment.narrativeSummary} [x402 premium: ${premium.summary}]`;
      }

      // Cache intelligence for the dashboard + Alpha-as-a-Service (x402 seller)
      this.lastWatchlist = marketOverview.watchlist || [];
      this.lastSentiment = sentiment;
      this.lastNarrative = sentiment.narrativeSummary;
      this.lastAlpha = {
        generatedAt: new Date().toISOString(),
        regime: marketOverview.market_read?.regime,
        compositeScore: marketOverview.market_read?.composite_score,
        overallSentiment: sentiment.overallScore,
        narrative: sentiment.narrativeSummary,
        watchlist: (marketOverview.watchlist || []).map(w => ({
          symbol: w.symbol, score: w.score, confidence: w.confidence, thesis: w.thesis
        })),
        tokens: sentiment.tokens,
        actionGuidance: marketOverview.action_guidance,
        disclaimer: 'LILA alpha feed. Not financial advice. Delivered via x402.'
      };

      // 5. Compile context and evaluate strategy
      const context: MarketContext = {
        overview: marketOverview,
        sentiment,
        currentPortfolioValueUsd: currentBalanceUsd
      };
      
      let decisions = await this.strategyEngine.evaluate(context, openPositions);

      // 5. Enforce minimum daily trading requirement
      decisions = this.tradeEnforcer.checkAndEnforce(decisions, openPositions, currentBalanceUsd);

      // 6. Execute decisions with risk guardrails
      for (const decision of decisions) {
        if (decision.action === 'HOLD') continue;

        logger.info(`Evaluating decision: ${decision.action} ${decision.tokenSymbol} ($${decision.amountUsd})`);
        
        const validation = this.riskManager.validateDecision(decision, currentBalanceUsd, openPositions);
        
        if (validation.allowed) {
          // Execute swap on BSC via TWAK
          // In case of selling, we swap token to WBNB or BNB (gas/native) or USDT
          const fromAsset = decision.action === 'BUY' ? 'BNB' : decision.tokenSymbol;
          const toAsset = decision.action === 'BUY' ? decision.tokenSymbol : 'BNB'; // Swapping back to gas or stable
          
          const swapResult = await this.twakClient.executeSwap(
            fromAsset,
            toAsset,
            decision.amountUsd || 1 // Sell $1 worth or buy $amountUsd
          );

          if (swapResult.success) {
            // Update trackers
            this.riskManager.recordTradeExecution(decision.amountUsd);
            this.tradeEnforcer.recordTrade();
            
            const executionPrice = parseFloat(swapResult.amountOut) / parseFloat(swapResult.amountIn);
            
            this.portfolioTracker.recordTrade(
              decision.action,
              decision.tokenSymbol,
              decision.amountUsd,
              parseFloat(swapResult.amountOut),
              executionPrice || 1,
              swapResult.txHash,
              decision.reasoning
            );
            
            logger.info(`Successfully executed trade: ${decision.action} ${decision.tokenSymbol}. Tx: ${swapResult.txHash}`);

            // Commit to the verifiable decision ledger (ERC-8004 track record)
            this.ledger.record({
              action: decision.action,
              token: decision.tokenSymbol,
              amountUsd: decision.amountUsd,
              reasoning: decision.reasoning,
              sentimentScore: sentiment.overallScore,
              regime: marketOverview.market_read?.regime,
              outcome: config.agentMode === 'paper' ? 'simulated' : 'executed',
              txHash: swapResult.txHash
            });
          } else {
            logger.error(`Trade execution failed: ${swapResult.error}`);
          }
        } else {
          logger.warn(`Trade blocked by Risk Manager: ${validation.reason}`);
          // Record blocked decisions too — the track record shows discipline, not just wins
          this.ledger.record({
            action: decision.action,
            token: decision.tokenSymbol,
            amountUsd: decision.amountUsd,
            reasoning: `BLOCKED: ${validation.reason}`,
            sentimentScore: sentiment.overallScore,
            regime: marketOverview.market_read?.regime,
            outcome: 'blocked'
          });
        }
      }

      // 7. Anchor the ledger root on-chain if new decisions were recorded
      if (this.ledger.hasPendingAnchor) {
        await this.ledger.anchor((root) => this.twakClient.anchorProof(root));
      }

      // 8. Push real-time update to dashboard
      this.pushDashboardUpdate(currentBalanceUsd);

    } catch (error: any) {
      logger.error(`Error in LILA orchestrator cycle: ${error.message}`);
    } finally {
      this.isProcessing = false;
      logger.info('--- Cycle Completed ---');
    }
  }

  /**
   * Build the candidate universe for a cycle: merge the CMC daily watchlist with a
   * rotating, momentum-ranked slice of the full eligible tradable universe. This lets
   * LILA scan across all 140+ eligible tokens over time and pick the best opportunities,
   * instead of being limited to the 3 tokens in the daily overview.
   */
  private async buildCandidateUniverse(baseWatchlist: WatchlistCandidate[]): Promise<WatchlistCandidate[]> {
    const SCAN_PER_CYCLE = 10;
    const MAX_CANDIDATES = 14;

    // Only tokens with a verified BSC swap route — the agent must be able to execute.
    const universe = getRoutableUniverse();
    // Rotating window so successive cycles cover different parts of the universe.
    const slice: string[] = [];
    for (let i = 0; i < SCAN_PER_CYCLE; i++) {
      slice.push(universe[(this.universeOffset + i) % universe.length]);
    }
    this.universeOffset = (this.universeOffset + SCAN_PER_CYCLE) % universe.length;

    // Symbols we want momentum for: the scan slice + existing watchlist names.
    const baseSymbols = baseWatchlist.map(w => w.symbol.toUpperCase());
    const wanted = Array.from(new Set([...slice, ...baseSymbols]));

    // Live momentum from CMC quotes (empty in paper/offline -> deterministic fallback).
    const momentum = await this.cmcClient.getQuotesMomentum(wanted);

    const pctFor = (symbol: string): number => {
      const live = momentum[symbol.toUpperCase()];
      if (typeof live === 'number') return live;
      // Deterministic pseudo-momentum (paper/offline): varies by symbol and hour so
      // the agent rotates its focus across the universe in a reproducible way.
      const seed = `${symbol.toUpperCase()}-${new Date().toISOString().slice(0, 13)}`;
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      return ((h % 1600) / 100) - 8; // range -8% .. +8%
    };

    const toCandidate = (symbol: string, existing?: WatchlistCandidate): WatchlistCandidate => {
      const pct = pctFor(symbol);
      const score = Math.max(5, Math.min(95, Math.round(50 + pct * 4)));
      const confidence = pct >= 4 ? 'high' : pct >= 1 ? 'medium' : 'low';
      const sign = pct >= 0 ? '+' : '';
      return existing
        ? { ...existing, score: existing.score || score }
        : {
            symbol: symbol.toUpperCase(),
            confidence,
            score,
            thesis: `Momentum scan: ${sign}${pct.toFixed(1)}% 24h. ${confidence === 'high' ? 'Strong relative strength.' : 'Monitoring for confirmation.'}`,
            confirmation_gap: '',
            invalidation: '',
            confirmation_chain: ['universe_momentum_scan']
          };
    };

    const routable = new Set(universe.map(s => s.toUpperCase()));
    const merged = new Map<string, WatchlistCandidate>();
    // Keep the CMC daily watchlist (richer thesis) first, but only if routable.
    baseWatchlist.forEach(w => {
      if (routable.has(w.symbol.toUpperCase())) merged.set(w.symbol.toUpperCase(), toCandidate(w.symbol, w));
    });
    // Add scanned universe candidates (all routable by construction).
    slice.forEach(sym => { if (!merged.has(sym.toUpperCase())) merged.set(sym.toUpperCase(), toCandidate(sym)); });

    // Rank by score and cap.
    return Array.from(merged.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, MAX_CANDIDATES);
  }

  /**
   * Compile current stats and push to dashboard
   */
  private pushDashboardUpdate(currentBalanceUsd: number): void {
    if (!this.onUpdateCallback) return;

    const stats = this.portfolioTracker.getStats(currentBalanceUsd);
    const riskStatus = this.riskManager.getStatus();
    const enforcerStatus = this.tradeEnforcer.getStatus();

    this.onUpdateCallback({
      agentName: 'LILA',
      website: 'lilagent.xyz',
      mode: config.agentMode,
      walletAddress: this.walletAddress,
      currentDay: new Date().toISOString().split('T')[0],
      stats,
      riskStatus,
      enforcerStatus,
      watchlist: this.lastWatchlist,
      sentiment: this.lastSentiment,
      narrative: this.lastNarrative,
      x402: this.lastX402,
      x402Earnings: this.seller.getEarnings(),
      proof: this.ledger.getProof(),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get current state snapshot
   */
  public async getDashboardData(): Promise<any> {
    // Use the valuation cached by the trade loop (avoids slow re-valuation per request).
    const portfolio = this.lastPortfolio
      || (config.agentMode === 'live' ? await this.twakClient.getBscValuation() : await this.twakClient.getPortfolio());
    const currentBalanceUsd = portfolio.totalUsdValue || config.startingBalanceUsd;
    const stats = this.portfolioTracker.getStats(currentBalanceUsd);
    const riskStatus = this.riskManager.getStatus();
    const enforcerStatus = this.tradeEnforcer.getStatus();
    const address = this.walletAddress || await this.twakClient.getAddress('bsc');

    return {
      agentName: 'LILA',
      website: 'lilagent.xyz',
      mode: config.agentMode,
      walletAddress: address,
      stats,
      riskStatus,
      enforcerStatus,
      watchlist: this.lastWatchlist,
      sentiment: this.lastSentiment,
      narrative: this.lastNarrative,
      x402: this.lastX402 || this.x402Client.getStatus(),
      x402Earnings: this.seller.getEarnings(),
      proof: this.ledger.getProof(),
      timestamp: new Date().toISOString()
    };
  }

  // ---- Alpha-as-a-Service (x402 seller) accessors used by the HTTP layer ----

  /** The intelligence payload sold behind the x402 paywall. */
  public getAlphaForSale(): any {
    return this.lastAlpha || {
      generatedAt: new Date().toISOString(),
      note: 'LILA is warming up — first market read not yet generated.',
      watchlist: this.lastWatchlist,
      disclaimer: 'LILA alpha feed. Not financial advice. Delivered via x402.'
    };
  }

  /** Build a 402 Payment Required response for the alpha resource. */
  public buildAlphaPaymentRequired(resourcePath: string) {
    return this.seller.buildPaymentRequired(resourcePath);
  }

  /** Verify + settle an x402 payment for the alpha resource. */
  public settleAlphaPayment(paymentHeader: string, resourcePath: string): Promise<PaymentSettlement> {
    return this.seller.settle(paymentHeader, resourcePath);
  }

  public isSellEnabled(): boolean {
    return config.x402SellEnabled;
  }

  /** Public verifiable track-record proof. */
  public getProof(): any {
    return this.ledger.getProof();
  }
}
