/**
 * Track 1 on-chain competition registration helper.
 *
 *   npm run compete:status     -> show whether the agent wallet is registered + deadline
 *   npm run compete:register   -> register the agent wallet on-chain (sends a BSC tx; needs gas)
 *
 * Credentials and wallet password are read from .env (loaded via config). Registration
 * targets the BNB HACK competition contract that the TWAK CLI has built in. This works
 * regardless of AGENT_MODE — you register once, then run the agent (paper or live).
 */
import { config } from '../core/config';
import { logger } from '../core/logger';
import { TwakClient } from '../execution/twak-client';

async function main() {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  const twak = new TwakClient();

  await twak.createWalletIfNotExists();
  const address = await twak.getAddress('bsc');
  logger.info(`Agent BSC wallet: ${address}`);

  const status = await twak.checkCompetitionStatus();
  logger.info(`Current status: ${JSON.stringify(status)}`);

  if (cmd === 'status') {
    if ((status as any).registered) {
      logger.info('✅ Already registered for Track 1.');
    } else if ((status as any).deadline) {
      logger.info(`Not registered yet. Registration deadline: ${(status as any).deadline}. Run "npm run compete:register" (wallet needs BNB for gas).`);
    }
    return;
  }

  if (cmd === 'register') {
    if ((status as any).registered) {
      logger.info('✅ Wallet is already registered — nothing to do.');
      return;
    }
    if (!config.twakWalletPassword) {
      logger.error('TWAK_WALLET_PASSWORD is required in .env to sign the registration transaction.');
      process.exit(1);
    }
    logger.info('Submitting on-chain registration transaction (requires BNB for gas)...');
    const result = await twak.registerCompetition();
    if (result.success) {
      logger.info(`🎉 Registered for Track 1! Tx: ${result.txHash}`);
      const after = await twak.checkCompetitionStatus();
      logger.info(`Verified status: ${JSON.stringify(after)}`);
    } else {
      logger.error(`Registration failed: ${result.error}`);
      logger.error('Most common cause: the wallet has no BNB for gas. Fund it and retry.');
      process.exit(1);
    }
    return;
  }

  logger.error(`Unknown command "${cmd}". Use "status" or "register".`);
  process.exit(1);
}

main().catch((e) => { logger.error(`compete script failed: ${e.message}`); process.exit(1); });
