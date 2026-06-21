import { logger } from '../core/logger';
import { config } from '../core/config';
import { MarketContext, TradeDecision, TokenSentiment } from './types';
import { isEligible } from '../config/eligible-tokens';

export class StrategyEngine {
  /**
   * Evaluate the market context and decide on actions (BUY, SELL, HOLD)
   */
  public async evaluate(context: MarketContext, openPositions: Record<string, number>): Promise<TradeDecision[]> {
    const decisions: TradeDecision[] = [];
    const { overview, sentiment } = context;

    logger.info('Evaluating trading strategy decisions...');

    // 1. Check for exit signals on current holdings
    for (const [symbol, amount] of Object.entries(openPositions)) {
      if (amount <= 0 || symbol === 'BNB') continue; // Skip gas token and empty positions

      // Find if we have sentiment data for this token
      const tokenSent = sentiment.tokens.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
      
      // Exit Condition A: Sentiment has turned significantly bearish
      if (tokenSent && tokenSent.score < -0.3) {
        logger.info(`EXIT SIGNAL: Sentiment for ${symbol} turned bearish (${tokenSent.score}). Deciding to sell.`);
        decisions.push({
          action: 'SELL',
          tokenSymbol: symbol,
          amountUsd: 0, // Sell entire position
          confidence: 0.9,
          reasoning: `Sentiment turned bearish (${tokenSent.score}): ${tokenSent.rationale}`,
          timestamp: new Date().toISOString()
        });
        continue;
      }

      // Exit Condition B: Market regime has deteriorated severely
      if (overview.market_read?.risk_bias === 'defensive_research_only' && sentiment.overallScore < -0.6) {
        logger.info(`EXIT SIGNAL: Extreme market headwinds. Closing speculative position in ${symbol}.`);
        decisions.push({
          action: 'SELL',
          tokenSymbol: symbol,
          amountUsd: 0, // Sell entire position
          confidence: 0.8,
          reasoning: 'Market regime turned extremely defensive. De-risking.',
          timestamp: new Date().toISOString()
        });
      }
    }

    // 2. Check for entry signals
    // If the market is strictly defensive and not forcing a trade, limit entries
    const isDefensive = overview.market_read?.risk_bias === 'defensive_research_only' || 
                        overview.trader_assessment?.decision_state === 'do_not_trade_until_confirmation';

    if (isDefensive) {
      logger.info('Market regime is defensive. New position entry criteria will be highly selective.');
    }

    // Sort candidates by combined score: score * impact
    const candidates = [...sentiment.tokens]
      .filter(t => isEligible(t.symbol) && t.symbol !== 'BNB')
      .sort((a, b) => (b.score * b.impact) - (a.score * a.impact));

    for (const candidate of candidates) {
      // Avoid opening duplicate positions
      if (openPositions[candidate.symbol] > 0) continue;

      const scoreThreshold = isDefensive ? 0.6 : 0.4;
      const combinedScore = candidate.score * candidate.impact;

      if (candidate.score >= scoreThreshold) {
        // We have a buy signal!
        // Position size is capped by config.maxTradeUsd ($5)
        const sizeUsd = Math.min(config.maxTradeUsd, 5);
        
        logger.info(`ENTRY SIGNAL: Bullish sentiment for ${candidate.symbol} (Score: ${candidate.score}, Combined: ${combinedScore.toFixed(2)})`);
        decisions.push({
          action: 'BUY',
          tokenSymbol: candidate.symbol,
          amountUsd: sizeUsd,
          confidence: candidate.score,
          reasoning: `Bullish sentiment score ${candidate.score} with impact ${candidate.impact}. ${candidate.rationale}`,
          timestamp: new Date().toISOString()
        });

        // Limit the number of concurrent new buys per cycle to prevent overexposure
        if (decisions.filter(d => d.action === 'BUY').length >= 2) {
          break;
        }
      }
    }

    if (decisions.length === 0) {
      logger.info('No actionable trading signals detected in this cycle. Decisions: HOLD.');
    }

    return decisions;
  }
}
