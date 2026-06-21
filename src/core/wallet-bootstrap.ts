import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from './logger';

/**
 * Materialize the TWAK wallet keystore from an environment secret.
 *
 * The TWAK CLI has no private-key/mnemonic import command — a wallet only exists as the
 * encrypted keystore at `~/.twak/wallet.json`. To run the *same* registered & funded
 * wallet on a cloud host (e.g. Railway), base64-encode that local keystore and set it as
 * the `TWAK_WALLET_KEYSTORE_B64` secret. On boot we write it into `~/.twak/wallet.json`
 * (only if not already present) so the agent controls the real address from the cloud.
 *
 * Security: the keystore is AES-encrypted and only usable together with
 * `TWAK_WALLET_PASSWORD`. Both living in the host's env grants full control of the
 * wallet — set them only on a trusted deployment, and never run the same wallet live in
 * two places at once (nonce conflicts / double-spends).
 */
export function materializeWalletFromEnv(): void {
  const b64 = process.env.TWAK_WALLET_KEYSTORE_B64;
  if (!b64) return;

  const dir = path.join(os.homedir(), '.twak');
  const file = path.join(dir, 'wallet.json');

  try {
    if (fs.existsSync(file)) {
      logger.info('TWAK wallet keystore already present — skipping import from env.');
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const content = Buffer.from(b64, 'base64').toString('utf8');
    // Sanity-check it looks like a JSON keystore before writing.
    JSON.parse(content);
    fs.writeFileSync(file, content, { mode: 0o600 });
    logger.info('Imported TWAK wallet keystore from TWAK_WALLET_KEYSTORE_B64 → ~/.twak/wallet.json');
  } catch (err: any) {
    logger.error(`Failed to import wallet keystore from env: ${err.message}`);
  }
}
