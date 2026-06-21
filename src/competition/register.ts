import { TwakClient } from '../execution/twak-client';
import { logger } from '../core/logger';
import { config } from '../core/config';

export async function runRegistrationFlow(): Promise<void> {
  logger.info('Starting LILA Agent Registration and Verification Flow...');
  
  const twak = new TwakClient();
  
  // 1. Ensure wallet exists
  await twak.createWalletIfNotExists();
  
  // 2. Resolve and display wallet address
  const bscAddress = await twak.getAddress('bsc');
  logger.info('====================================================');
  logger.info(`LILA Agent BSC Wallet Address: ${bscAddress}`);
  logger.info('====================================================');
  logger.info('IMPORTANT: Ensure this wallet is funded with BNB (for gas) and USDC/tokens before live trading.');
  
  if (config.agentMode === 'paper') {
    logger.info('[PAPER MODE] Skipping on-chain registration transactions.');
    return;
  }

  // 3. Verify Competition Registration Status
  try {
    const status = await twak.checkCompetitionStatus();
    if (status.registered) {
      logger.info('Agent is already registered for the BNB Hack: AI Trading Agent Edition! ✅');
    } else {
      logger.info('Agent is NOT registered for the competition. Attempting on-chain registration...');
      const regResult = await twak.registerCompetition();
      if (regResult.success) {
        logger.info(`Competition registration successful! Tx: ${regResult.txHash} 🎉`);
      } else {
        logger.error(`Competition registration failed: ${regResult.error}. Please check wallet balance (requires gas).`);
      }
    }
  } catch (error: any) {
    logger.error(`Failed to verify or register for competition: ${error.message}`);
  }

  // 4. Mint/Register ERC-8004 Agent Identity on-chain
  try {
    logger.info('Verifying ERC-8004 Agent Identity on-chain...');
    // We register the identity with the agent metadata URL
    const metadataUri = 'https://lilagent.xyz/metadata.json';
    const ercResult = await twak.registerErc8004Identity('LILA', metadataUri);
    logger.info(`ERC-8004 Identity Transaction: ${ercResult} ✅`);
  } catch (error: any) {
    logger.error(`Failed to register ERC-8004 Identity: ${error.message}`);
  }
}

// Allow executing directly as a script
if (require.main === module) {
  runRegistrationFlow()
    .then(() => {
      logger.info('Registration flow completed.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error(`Registration flow failed: ${err.message}`);
      process.exit(1);
    });
}
