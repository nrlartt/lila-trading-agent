import { logger } from '../core/logger';
import { config } from '../core/config';
import { TradeDecision } from '../agent/types';
import { isEligible } from '../config/eligible-tokens';

export class RiskManager {
  private dailySpendUsd: number = 0;
  private lastResetTimestamp: number = Date.now();

  /**
   * Validate if a proposed trade complies with all risk rules and guardrails
   */
  public validateDecision(
    decision: TradeDecision,
    currentPortfolioValue: number,
    openPositions: Record<string, number>
  ): { allowed: boolean; reason?: string } {
    // 0. Reset daily spend if 24 hours have passed
    const now = Date.now();
    if (now - this.lastResetTimestamp >= 24 * 60 * 60 * 1000) {
      logger.info('Resetting daily risk manager spend counter.');
      this.dailySpendUsd = 0;
      this.lastResetTimestamp = now;
    }

    const { action, tokenSymbol, amountUsd } = decision;

    // Sells are always allowed (de-risking/taking profit)
    if (action === 'SELL') {
      return { allowed: true };
    }

    if (action === 'HOLD') {
      return { allowed: true };
    }

    // 1. Verify token is in eligible allowlist
    if (!isEligible(tokenSymbol)) {
      return {
        allowed: false,
        reason: `Token ${tokenSymbol} is not in the 149 eligible BEP-20 token allowlist.`
      };
    }

    // 2. Check drawdown limit
    const startingBalance = config.startingBalanceUsd;
    const currentDrawdownPct = ((startingBalance - currentPortfolioValue) / startingBalance) * 100;
    
    if (currentDrawdownPct >= config.maxDrawdownPct) {
      return {
        allowed: false,
        reason: `Drawdown limit reached! Max Drawdown is ${config.maxDrawdownPct}%, current drawdown is ${currentDrawdownPct.toFixed(2)}% (Portfolio: $${currentPortfolioValue.toFixed(2)}, Start: $${startingBalance.toFixed(2)})`
      };
    }

    // 3. Check per-trade limit ($5 max)
    if (amountUsd > config.maxTradeUsd) {
      return {
        allowed: false,
        reason: `Proposed trade size of $${amountUsd} exceeds the maximum per-trade limit of $${config.maxTradeUsd}.`
      };
    }

    // 4. Check daily spend limit ($10 max cumulative)
    if (this.dailySpendUsd + amountUsd > config.dailyLimitUsd) {
      return {
        allowed: false,
        reason: `Trade of $${amountUsd} would exceed the remaining daily spend limit of $${(config.dailyLimitUsd - this.dailySpendUsd).toFixed(2)} (Spent today: $${this.dailySpendUsd.toFixed(2)})`
      };
    }

    // 5. Check dust protection rule
    // We must never let our total portfolio value fall below $1 to qualify for hourly returns
    if (currentPortfolioValue - amountUsd < 1.0) {
      return {
        allowed: false,
        reason: `Trade of $${amountUsd} would risk pushing portfolio value below the $1 dust limit required for qualification.`
      };
    }

    return { allowed: true };
  }

  /**
   * Record that a trade has completed successfully to track daily spending limit
   */
  public recordTradeExecution(amountUsd: number): void {
    this.dailySpendUsd += amountUsd;
    logger.info(`RiskManager recorded execution. Daily spend: $${this.dailySpendUsd.toFixed(2)} / $${config.dailyLimitUsd.toFixed(2)}`);
  }

  public getStatus() {
    return {
      dailySpendUsd: this.dailySpendUsd,
      maxDailyLimit: config.dailyLimitUsd,
      remainingDailyLimit: Math.max(0, config.dailyLimitUsd - this.dailySpendUsd),
      lastResetTime: new Date(this.lastResetTimestamp).toISOString()
    };
  }
}
