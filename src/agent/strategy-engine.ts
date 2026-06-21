import { logger } from '../core/logger';
import { config } from '../core/config';
import { MarketContext, TradeDecision, OpenPositionInfo } from './types';
import { isEligible } from '../config/eligible-tokens';

export class StrategyEngine {
  /**
   * Evaluate the market context and decide on actions (BUY, SELL, HOLD).
   *
   * Exit logic (in priority order): take-profit / stop-loss on USD cost basis,
   * bearish sentiment reversal, and defensive-regime de-risking. Entry logic ranks
   * eligible candidates by sentiment × impact. Capital rotation frees BNB by selling
   * the weakest holding when a stronger opportunity appears but BNB is insufficient.
   *
   * Returned decisions put SELLs before BUYs so freed BNB funds the rotation buy.
   */
  public async evaluate(
    context: MarketContext,
    openPositions: Record<string, number>,
    positions: OpenPositionInfo[] = [],
    availableBnbUsd: number = 0
  ): Promise<TradeDecision[]> {
    const sells: TradeDecision[] = [];
    const buys: TradeDecision[] = [];
    const selling = new Set<string>();
    const { overview, sentiment } = context;

    logger.info('Evaluating trading strategy decisions...');

    const scoreFor = (symbol: string): number => {
      const t = sentiment.tokens.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
      return t ? t.score : 0;
    };
    const posBySymbol = new Map(positions.map(p => [p.symbol.toUpperCase(), p]));

    const isDefensive = overview.market_read?.risk_bias === 'defensive_research_only' ||
                        overview.trader_assessment?.decision_state === 'do_not_trade_until_confirmation';

    // 1. EXITS on current holdings
    for (const [symbol, amount] of Object.entries(openPositions)) {
      if (amount <= 0 || symbol === 'BNB') continue;
      const sym = symbol.toUpperCase();
      const pos = posBySymbol.get(sym);
      const tokenScore = scoreFor(sym);

      // 1a. Take-profit / stop-loss on USD cost basis
      if (pos && pos.costUsd > 0 && pos.currentUsd > 0) {
        const pnlPct = ((pos.currentUsd - pos.costUsd) / pos.costUsd) * 100;
        if (pnlPct >= config.takeProfitPct) {
          logger.info(`TAKE-PROFIT: ${sym} +${pnlPct.toFixed(1)}% (cost $${pos.costUsd.toFixed(2)} → $${pos.currentUsd.toFixed(2)}). Selling.`);
          sells.push(this.sell(sym, `Take-profit: +${pnlPct.toFixed(1)}% vs cost basis.`, 0.95));
          selling.add(sym);
          continue;
        }
        if (pnlPct <= -config.stopLossPct) {
          logger.info(`STOP-LOSS: ${sym} ${pnlPct.toFixed(1)}% (cost $${pos.costUsd.toFixed(2)} → $${pos.currentUsd.toFixed(2)}). Selling.`);
          sells.push(this.sell(sym, `Stop-loss: ${pnlPct.toFixed(1)}% vs cost basis.`, 0.95));
          selling.add(sym);
          continue;
        }
      }

      // 1b. Sentiment turned bearish
      if (tokenScore < -0.3) {
        logger.info(`EXIT: ${sym} sentiment bearish (${tokenScore}). Selling.`);
        sells.push(this.sell(sym, `Sentiment turned bearish (${tokenScore}).`, 0.9));
        selling.add(sym);
        continue;
      }

      // 1c. Severe defensive regime
      if (overview.market_read?.risk_bias === 'defensive_research_only' && sentiment.overallScore < -0.6) {
        logger.info(`EXIT: extreme defensive regime. De-risking ${sym}.`);
        sells.push(this.sell(sym, 'Market regime turned extremely defensive. De-risking.', 0.8));
        selling.add(sym);
      }
    }

    // 2. ENTRIES — rank eligible candidates by score × impact
    if (isDefensive) {
      logger.info('Market regime is defensive. Entry criteria highly selective.');
    }
    const candidates = [...sentiment.tokens]
      .filter(t => isEligible(t.symbol) && t.symbol.toUpperCase() !== 'BNB')
      .sort((a, b) => (b.score * b.impact) - (a.score * a.impact));

    const scoreThreshold = isDefensive ? 0.6 : 0.4;
    let topBuyScore = 0;
    for (const candidate of candidates) {
      if (openPositions[candidate.symbol] > 0) continue; // already hold it
      if (candidate.score < scoreThreshold) continue;
      const sizeUsd = config.maxTradeUsd;
      if (!topBuyScore) topBuyScore = candidate.score;
      logger.info(`ENTRY: ${candidate.symbol} (score ${candidate.score}, impact ${candidate.impact}).`);
      buys.push({
        action: 'BUY',
        tokenSymbol: candidate.symbol,
        amountUsd: sizeUsd,
        confidence: candidate.score,
        reasoning: `Bullish sentiment ${candidate.score} (impact ${candidate.impact}). ${candidate.rationale}`,
        timestamp: new Date().toISOString()
      });
      if (buys.length >= 2) break;
    }

    // 3. CAPITAL ROTATION — if we want to buy but lack BNB, sell the weakest holding
    if (buys.length > 0 && availableBnbUsd < config.maxTradeUsd) {
      const rotatable = positions
        .filter(p => p.symbol.toUpperCase() !== 'BNB' && !selling.has(p.symbol.toUpperCase()) && p.currentUsd > 0)
        .map(p => ({ ...p, score: scoreFor(p.symbol) }))
        .sort((a, b) => a.score - b.score); // weakest first

      const weakest = rotatable[0];
      if (weakest && weakest.score < topBuyScore - 0.1) {
        logger.info(`ROTATION: low BNB ($${availableBnbUsd.toFixed(2)}). Selling weakest holding ${weakest.symbol} (score ${weakest.score.toFixed(2)}) to fund a stronger entry (score ${topBuyScore.toFixed(2)}).`);
        sells.push(this.sell(weakest.symbol, `Rotation: freeing capital for a higher-conviction entry (${topBuyScore.toFixed(2)} > ${weakest.score.toFixed(2)}).`, 0.85));
        selling.add(weakest.symbol.toUpperCase());
      }
    }

    if (sells.length === 0 && buys.length === 0) {
      logger.info('No actionable signals this cycle. HOLD.');
    }

    // SELLs first so freed BNB funds the buys
    return [...sells, ...buys];
  }

  private sell(symbol: string, reasoning: string, confidence: number): TradeDecision {
    return {
      action: 'SELL',
      tokenSymbol: symbol,
      amountUsd: 0, // full position
      confidence,
      reasoning,
      timestamp: new Date().toISOString()
    };
  }
}
