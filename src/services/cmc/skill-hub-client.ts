import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { logger } from '../../core/logger';
import { config } from '../../core/config';
import { DailyMarketOverviewData, CmcSkillResponse, WatchlistCandidate } from './types';

/**
 * Client for the CoinMarketCap AI Agent Hub (MCP).
 *
 * Primary transport is Streamable HTTP against `https://mcp.coinmarketcap.com/mcp`
 * with header-based auth (`X-CMC-MCP-API-KEY`). If that fails we fall back to the
 * legacy SSE Skill-Hub stream, and finally to deterministic mock data so the agent
 * (and dashboard) keep running in paper / offline mode.
 */
export class CmcSkillHubClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | SSEClientTransport | null = null;
  private toolNames: string[] = [];

  /**
   * Connect to the CoinMarketCap AI Agent Hub MCP server
   */
  public async connect(): Promise<void> {
    // Offline mode: no key configured while paper trading -> use mock data.
    if (!config.cmcMcpApiKey) {
      if (config.agentMode === 'paper') {
        logger.info('[PAPER MODE] CMC AI Agent Hub initialized in offline/mock mode (no CMC_MCP_API_KEY).');
        return;
      }
      logger.warn('CMC_MCP_API_KEY is not set. CMC intelligence will use mock data.');
      return;
    }

    const headers = { 'X-CMC-MCP-API-KEY': config.cmcMcpApiKey };

    this.client = new Client(
      { name: 'lila-trading-agent', version: '1.0.0' },
      { capabilities: {} }
    );

    // 1. Try Streamable HTTP (the current CMC transport).
    try {
      logger.info(`Connecting to CoinMarketCap AI Agent Hub at ${config.cmcMcpUrl} (Streamable HTTP)...`);
      this.transport = new StreamableHTTPClientTransport(new URL(config.cmcMcpUrl), {
        requestInit: { headers }
      });
      await this.client.connect(this.transport);
      await this.discoverTools();
      logger.info('Connected to CoinMarketCap AI Agent Hub (Streamable HTTP).');
      return;
    } catch (error: any) {
      logger.warn(`Streamable HTTP connection failed: ${error.message}. Trying legacy SSE transport...`);
    }

    // 2. Fall back to the legacy SSE Skill-Hub stream.
    try {
      const sseUrl = new URL('https://mcp.coinmarketcap.com/skill-hub/stream');
      this.transport = new SSEClientTransport(sseUrl, {
        eventSourceInit: { headers } as any,
        requestInit: { headers }
      });
      this.client = new Client(
        { name: 'lila-trading-agent', version: '1.0.0' },
        { capabilities: {} }
      );
      await this.client.connect(this.transport);
      await this.discoverTools();
      logger.info('Connected to CoinMarketCap Skill Hub (SSE fallback).');
    } catch (error: any) {
      logger.error(`Failed to connect to CoinMarketCap MCP (all transports): ${error.message}. Falling back to mock data.`);
      this.client = null;
      this.transport = null;
    }
  }

  /**
   * List the tools exposed by the server so we can pick the right one to call.
   */
  private async discoverTools(): Promise<void> {
    try {
      const res = (await this.client!.listTools()) as any;
      this.toolNames = (res?.tools || []).map((t: any) => t.name);
      logger.info(`CMC MCP exposes ${this.toolNames.length} tools: ${this.toolNames.join(', ')}`);
    } catch (error: any) {
      logger.warn(`Could not list CMC MCP tools: ${error.message}`);
      this.toolNames = [];
    }
  }

  /**
   * Find the first discovered tool whose name contains any of the keywords.
   */
  private findTool(...keywords: string[]): string | undefined {
    return this.toolNames.find(name =>
      keywords.some(k => name.toLowerCase().includes(k.toLowerCase()))
    );
  }

  /**
   * Call a tool and return its first text content parsed as JSON (or the raw text).
   */
  private async callToolJson(name: string, args: Record<string, any> = {}): Promise<any> {
    const response = (await this.client!.callTool({ name, arguments: args })) as any;
    const block = response?.content?.find((c: any) => c.type === 'text');
    if (!block?.text) return null;
    try {
      return JSON.parse(block.text);
    } catch {
      return block.text;
    }
  }

  /**
   * Disconnect from the MCP server
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.transport) {
        await this.transport.close();
      }
    } catch (error: any) {
      logger.error(`Error closing CMC MCP transport: ${error.message}`);
    } finally {
      this.client = null;
      this.transport = null;
    }
  }

  /**
   * Produce a daily market overview used by the sentiment + strategy engines.
   * Tries the Skill Hub workflow first, then composes one from base MCP tools,
   * then finally returns deterministic mock data.
   */
  public async getDailyMarketOverview(preview: boolean = true): Promise<DailyMarketOverviewData> {
    if (!this.client) {
      if (config.agentMode !== 'paper') {
        logger.warn('CMC client not connected. Attempting to (re)connect...');
        await this.connect();
      }
      if (!this.client) {
        logger.info('Using mock daily market overview (CMC offline).');
        return this.generateMockOverview();
      }
    }

    // 1. Preferred: the Skill Hub workflow that returns a ready-made evidence pack.
    const skillTool = this.findTool('execute_skill', 'skill');
    if (skillTool) {
      try {
        logger.info(`Executing CMC skill workflow via tool: ${skillTool}`);
        const parsed = await this.callToolJson(skillTool, {
          unique_name: 'daily_market_overview',
          parameters: { preview }
        });
        const data = (parsed as CmcSkillResponse)?.result?.data;
        if (data && data.watchlist) {
          logger.info('Received daily_market_overview evidence pack from CMC Skill Hub.');
          return data;
        }
      } catch (error: any) {
        logger.warn(`Skill Hub workflow failed: ${error.message}. Composing overview from base tools.`);
      }
    }

    // 2. Compose an overview from the 12 base CMC tools.
    try {
      const composed = await this.composeOverviewFromBaseTools();
      if (composed) {
        logger.info('Composed daily market overview from CoinMarketCap base tools.');
        return composed;
      }
    } catch (error: any) {
      logger.warn(`Composing overview from base tools failed: ${error.message}.`);
    }

    // 3. Last resort.
    logger.info('Falling back to mock daily market overview.');
    return this.generateMockOverview();
  }

  /**
   * Fetch 24h price momentum for a set of symbols via the CMC "quotes" tool.
   * Returns a map of SYMBOL -> percent_change_24h. Best-effort: empty map on failure.
   */
  public async getQuotesMomentum(symbols: string[]): Promise<Record<string, number>> {
    if (!this.client || symbols.length === 0) return {};
    const tool = this.findTool('live_quotes', 'quotes', 'quote', 'price');
    if (!tool) return {};
    const joined = symbols.join(',');
    try {
      const data = await this.callToolJson(tool, { symbol: joined, symbols: joined });
      return this.extractMomentum(data);
    } catch (error: any) {
      logger.warn(`CMC quotes momentum fetch failed: ${error.message}`);
      return {};
    }
  }

  /** Walk a quotes payload and pull out SYMBOL -> percent_change_24h pairs. */
  private extractMomentum(node: any, out: Record<string, number> = {}): Record<string, number> {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { node.forEach(n => this.extractMomentum(n, out)); return out; }
    const sym = node.symbol || node.ticker;
    const pct = node.percent_change_24h ?? node.percentChange24h ?? node.priceChange24h
      ?? node.quote?.USD?.percent_change_24h;
    if (typeof sym === 'string' && typeof pct === 'number') {
      out[sym.toUpperCase()] = pct;
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') this.extractMomentum(v, out);
    }
    return out;
  }

  /**
   * Build a DailyMarketOverviewData object from live CMC tools
   * (global metrics + trending narratives + latest news).
   */
  private async composeOverviewFromBaseTools(): Promise<DailyMarketOverviewData | null> {
    const globalTool = this.findTool('global', 'market_metrics', 'global_metrics');
    const trendingTool = this.findTool('trending', 'narrative');
    const newsTool = this.findTool('news');

    const [global, trending, news] = await Promise.all([
      globalTool ? this.callToolJson(globalTool).catch(() => null) : null,
      trendingTool ? this.callToolJson(trendingTool).catch(() => null) : null,
      newsTool ? this.callToolJson(newsTool).catch(() => null) : null
    ]);

    if (!global && !trending && !news) return null;

    // Derive a 0-100 composite score from global market cap 24h change if available.
    const mcChange = this.deepFindNumber(global, ['market_cap_change', 'percent_change_24h', 'total_market_cap_yesterday_percentage_change']);
    const composite = mcChange !== undefined
      ? Math.max(0, Math.min(100, 50 + mcChange * 5))
      : 50;

    const watchlist = this.extractWatchlist(trending);
    const summary = this.extractSummary(news) || 'Live CoinMarketCap market read compiled from global metrics and trending narratives.';

    const overview = this.generateMockOverview();
    overview.summary = summary;
    overview.market_read.composite_score = Math.round(composite);
    overview.market_read.regime = composite >= 60 ? 'risk_on' : composite <= 40 ? 'risk_off' : 'neutral_consolidation';
    if (watchlist.length > 0) {
      overview.watchlist = watchlist;
    }
    overview.timestamp = new Date().toISOString();
    overview.confidence = 'medium';
    return overview;
  }

  /**
   * Best-effort extraction of candidate tokens from a trending-narratives payload.
   */
  private extractWatchlist(trending: any): WatchlistCandidate[] {
    const candidates: WatchlistCandidate[] = [];
    const seen = new Set<string>();

    const visit = (node: any) => {
      if (!node || candidates.length >= 8) return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node === 'object') {
        const symbol = node.symbol || node.ticker || node.coin || node.name;
        if (typeof symbol === 'string' && /^[A-Za-z0-9]{2,12}$/.test(symbol) && !seen.has(symbol.toUpperCase())) {
          seen.add(symbol.toUpperCase());
          const score = typeof node.score === 'number' ? node.score
            : typeof node.rank === 'number' ? Math.max(40, 90 - node.rank * 5)
            : 60;
          candidates.push({
            symbol: symbol.toUpperCase(),
            confidence: score >= 70 ? 'high' : 'medium',
            score,
            thesis: node.thesis || node.description || node.narrative || `${symbol.toUpperCase()} is trending on CoinMarketCap narratives.`,
            confirmation_gap: '',
            invalidation: '',
            confirmation_chain: ['trending_narrative']
          });
        }
        Object.values(node).forEach(visit);
      }
    };

    visit(trending);
    return candidates;
  }

  /** Find the first short text summary in a news payload. */
  private extractSummary(news: any): string | undefined {
    let found: string | undefined;
    const visit = (node: any) => {
      if (found || !node) return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (typeof node === 'object') {
        const candidate = node.title || node.headline || node.summary;
        if (typeof candidate === 'string' && candidate.length > 10) {
          found = candidate;
          return;
        }
        Object.values(node).forEach(visit);
      }
    };
    visit(news);
    return found;
  }

  /** Recursively search an object for the first numeric value under any of the given keys. */
  private deepFindNumber(node: any, keys: string[]): number | undefined {
    if (!node || typeof node !== 'object') return undefined;
    for (const key of keys) {
      if (typeof node[key] === 'number') return node[key];
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        const found = this.deepFindNumber(value, keys);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  /**
   * Fallback mock market overview generator for testing & paper trading
   */
  private generateMockOverview(): DailyMarketOverviewData {
    return {
      type: 'evidence_pack',
      skill_id: 'daily_market_overview',
      timestamp: new Date().toISOString(),
      status: 'ok',
      confidence: 'medium',
      summary: 'Market is in a consolidative phase. Bitcoin is stable above support, but altcoins show mixed strength.',
      market_read: {
        regime: 'neutral_consolidation',
        primary_driver: 'stablecoin_liquidity',
        risk_bias: 'neutral_selectivity',
        macro_regime: 'neutral',
        composite_score: 65,
        risk_budget: {
          stance: 'selective',
          max_position_pct: 50,
          leverage: 'avoid',
          not_for: 'high_frequency'
        },
        primary_conflicts: [],
        confirmation_triggers: ['BTC volume stable'],
        invalidation_triggers: ['BTC drops below $65,000']
      },
      trader_assessment: {
        market_regime: 'consolidation',
        risk_bias: 'neutral_selective',
        decision_state: 'trade_with_strict_stops',
        confidence: 'medium',
        risk_flags: []
      },
      watchlist: [
        {
          symbol: 'CAKE',
          confidence: 'high',
          score: 75.5,
          thesis: 'CAKE has established solid support near EMA50 and is experiencing rising trading volume.',
          confirmation_gap: 'breakout above $2.20',
          invalidation: 'price falls below $1.90',
          confirmation_chain: ['spot volume', 'ema50 support']
        },
        {
          symbol: 'TWT',
          confidence: 'medium',
          score: 68.2,
          thesis: 'TWT exhibits positive sentiment due to wallet kit updates and active on-chain usage.',
          confirmation_gap: 'breakout above $0.95',
          invalidation: 'price falls below $0.85',
          confirmation_chain: ['sentiment scan']
        },
        {
          symbol: 'ETH',
          confidence: 'high',
          score: 82.0,
          thesis: 'ETH remains the primary institutional beta asset. Strong spot absorption.',
          confirmation_gap: 'breakout above $3,500',
          invalidation: 'price falls below $3,200',
          confirmation_chain: ['ETF flow accumulation']
        }
      ],
      trader_readouts: [],
      action_guidance: {
        bias: 'selective_longs',
        reference_action: 'Trade high-score spot candidates with strict stop-losses',
        monitor: ['BTC price action near support', 'Stablecoin inflows'],
        upgrade_conditions: ['Volume expansion'],
        downgrade_conditions: ['Support break']
      }
    };
  }
}
