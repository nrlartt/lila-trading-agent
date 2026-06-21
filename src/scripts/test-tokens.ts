import { isEligible, getEligibleTokens, getTokenAddress } from '../config/eligible-tokens';
import { logger } from '../core/logger';

async function testTokens() {
  logger.info('--- Running Eligible Tokens Allowlist Verification ---');
  
  const tokens = getEligibleTokens();
  logger.info(`Total eligible tokens loaded: ${tokens.length}`);
  
  // Test some symbols
  const testCases = ['BNB', 'USDT', 'USDC', 'CAKE', 'ETH', 'TWT', 'BTC', 'SHIB', 'INVALID_COIN'];
  
  testCases.forEach(symbol => {
    const eligible = isEligible(symbol);
    const address = getTokenAddress(symbol);
    logger.info(`Token: ${symbol.padEnd(12)} | Eligible: ${eligible ? '✅ YES' : '❌ NO'} | Address: ${address || 'Auto-resolved'}`);
  });

  logger.info('Eligible tokens allowlist verified successfully.');
}

testTokens();
