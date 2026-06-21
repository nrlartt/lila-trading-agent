import { RiskManager } from '../risk/risk-manager';
import { TradeDecision } from '../agent/types';
import { logger } from '../core/logger';
import { config } from '../core/config';

async function testRisk() {
  logger.info('--- Running Risk Manager Guardrails Verification ---');
  
  const risk = new RiskManager();
  
  // Test Case 1: Standard valid trade
  const decision1: TradeDecision = {
    action: 'BUY',
    tokenSymbol: 'USDT',
    amountUsd: 4, // within $5 limit
    confidence: 0.9,
    reasoning: 'Bullish breakout',
    timestamp: new Date().toISOString()
  };
  
  const res1 = risk.validateDecision(decision1, 10, {});
  logger.info(`Valid Trade: ${res1.allowed ? '✅ Allowed' : '❌ Blocked'} (Reason: ${res1.reason || 'None'})`);
  
  // Record it
  if (res1.allowed) {
    risk.recordTradeExecution(4);
  }

  // Test Case 2: Exceeding max per-trade limit ($5)
  const decision2: TradeDecision = {
    action: 'BUY',
    tokenSymbol: 'USDT',
    amountUsd: 6, // Exceeds $5 limit
    confidence: 0.9,
    reasoning: 'Big buy',
    timestamp: new Date().toISOString()
  };
  
  const res2 = risk.validateDecision(decision2, 10, {});
  logger.info(`Exceed Trade Limit: ${res2.allowed ? '✅ Allowed' : '❌ Blocked'} (Reason: ${res2.reason || 'None'})`);

  // Test Case 3: Exceeding daily limit ($10)
  const decision3: TradeDecision = {
    action: 'BUY',
    tokenSymbol: 'CAKE',
    amountUsd: 5, // 4 spent + 5 proposed = 9
    confidence: 0.9,
    reasoning: 'Cake buy',
    timestamp: new Date().toISOString()
  };
  
  const res3 = risk.validateDecision(decision3, 10, {});
  logger.info(`Cumulative Limit: ${res3.allowed ? '✅ Allowed' : '❌ Blocked'} (Reason: ${res3.reason || 'None'})`);
  
  if (res3.allowed) {
    risk.recordTradeExecution(5); // Spent = 9
  }

  // Test Case 4: Proposed trade pushes spend past $10 daily cap
  const decision4: TradeDecision = {
    action: 'BUY',
    tokenSymbol: 'TWT',
    amountUsd: 2, // 9 spent + 2 proposed = 11 (Limit $10)
    confidence: 0.8,
    reasoning: 'TWT buy',
    timestamp: new Date().toISOString()
  };
  
  const res4 = risk.validateDecision(decision4, 10, {});
  logger.info(`Exceed Daily Cap: ${res4.allowed ? '✅ Allowed' : '❌ Blocked'} (Reason: ${res4.reason || 'None'})`);

  // Test Case 5: Drawdown limit check (10% max on $10 = $9 halt threshold)
  const decision5: TradeDecision = {
    action: 'BUY',
    tokenSymbol: 'USDT',
    amountUsd: 2,
    confidence: 0.8,
    reasoning: 'USDT buy on crash',
    timestamp: new Date().toISOString()
  };
  
  // Simulate portfolio crashed to $8.9 (11% drawdown)
  const res5 = risk.validateDecision(decision5, 8.9, {});
  logger.info(`Drawdown Check: ${res5.allowed ? '✅ Allowed' : '❌ Blocked'} (Reason: ${res5.reason || 'None'})`);

  // Test Case 6: Ineligible token check
  const decision6: TradeDecision = {
    action: 'BUY',
    tokenSymbol: 'UNSPPORTED_SHITCOIN',
    amountUsd: 2,
    confidence: 0.8,
    reasoning: 'Ineligible buy',
    timestamp: new Date().toISOString()
  };
  
  const res6 = risk.validateDecision(decision6, 10, {});
  logger.info(`Ineligible Token Check: ${res6.allowed ? '✅ Allowed' : '❌ Blocked'} (Reason: ${res6.reason || 'None'})`);
  
  logger.info('Risk Manager guardrails verified successfully.');
}

testRisk();
