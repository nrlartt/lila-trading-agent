import { logger } from '../core/logger';
import { TradeDecision } from './types';
import { getEligibleTokens } from '../config/eligible-tokens';

export class DailyTradeEnforcer {
  private lastTradeTimestamp: number = 0;
  private dailyTradeCount: number = 0;
  private lastCheckedDay: string = '';

  constructor() {
    this.lastTradeTimestamp = Date.now();
    this.lastCheckedDay = new Date().toISOString().split('T')[0];
  }

  /**
   * Record that a trade has occurred
   */
  public recordTrade(): void {
    this.lastTradeTimestamp = Date.now();
    this.dailyTradeCount++;
    logger.info(`Trade recorded by DailyTradeEnforcer. Daily trade count: ${this.dailyTradeCount}`);
  }

  /**
   * Check if we need to force a trade to satisfy the "1 trade per day" qualification rule
   */
  public checkAndEnforce(
    currentDecisions: TradeDecision[],
    openPositions: Record<string, number>,
    portfolioValueUsd: number
  ): TradeDecision[] {
    const currentDay = new Date().toISOString().split('T')[0];

    // Reset daily count if day has changed
    if (currentDay !== this.lastCheckedDay) {
      logger.info(`Day transition from ${this.lastCheckedDay} to ${currentDay}. Resetting daily trade count.`);
      this.lastCheckedDay = currentDay;
      this.dailyTradeCount = 0;
    }

    // If there is already a trade decision in the queue (BUY or SELL), we don't need to force one
    const hasActiveTrade = currentDecisions.some(d => d.action === 'BUY' || d.action === 'SELL');
    if (hasActiveTrade) {
      return currentDecisions;
    }

    // If we have already traded today, we are safe
    if (this.dailyTradeCount > 0) {
      return currentDecisions;
    }

    // If we haven't traded in the last 18 hours, we must force a trade to prevent disqualification
    const msSinceLastTrade = Date.now() - this.lastTradeTimestamp;
    const hoursSinceLastTrade = msSinceLastTrade / (1000 * 60 * 60);

    if (hoursSinceLastTrade >= 18) {
      logger.warn(`WARNING: No trades executed in the last ${hoursSinceLastTrade.toFixed(1)} hours. Forcing activity trade to satisfy the "1 trade/day" competition rule.`);

      // Decide which token to trade
      // If we hold USDT (or any token besides BNB), let's sell $1 of it back to BNB
      const nonBnbToken = Object.keys(openPositions).find(symbol => symbol !== 'BNB' && openPositions[symbol] > 0);

      if (nonBnbToken) {
        logger.info(`Forced Activity Trade: Selling small amount ($1) of existing holding ${nonBnbToken} for BNB.`);
        return [
          {
            action: 'SELL',
            tokenSymbol: nonBnbToken,
            amountUsd: 1, // Sell just $1 worth
            confidence: 1.0,
            reasoning: 'Forced activity trade: De-risking/Rebalancing $1 to meet daily 1-trade minimum.',
            timestamp: new Date().toISOString()
          }
        ];
      } else {
        // If we only hold BNB, swap $1 worth of BNB for a high-quality eligible token (e.g. USDT)
        logger.info('Forced Activity Trade: Buying $1 of USDT with BNB.');
        return [
          {
            action: 'BUY',
            tokenSymbol: 'USDT',
            amountUsd: 1, // Buy just $1 worth
            confidence: 1.0,
            reasoning: 'Forced activity trade: Initializing $1 USDT position to meet daily 1-trade minimum.',
            timestamp: new Date().toISOString()
          }
        ];
      }
    }

    return currentDecisions;
  }

  public getStatus() {
    return {
      dailyTradeCount: this.dailyTradeCount,
      lastTradeTime: new Date(this.lastTradeTimestamp).toISOString(),
      hoursSinceLastTrade: (Date.now() - this.lastTradeTimestamp) / (1000 * 60 * 60)
    };
  }
}
