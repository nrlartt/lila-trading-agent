import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../core/logger';
import { config } from '../core/config';

/**
 * Verifiable, tamper-evident decision ledger (ERC-8004 reputation backbone).
 *
 * Every trading decision LILA makes is appended to a hash-linked chain: each entry
 * commits to the previous entry's hash, so the entire history forms a mini-blockchain
 * that anyone can recompute from the public log and verify. The current root hash is
 * periodically *anchored* on-chain (via the agent's ERC-8004 identity / attestation),
 * giving LILA a trustless, auditable track record instead of a self-reported one.
 */

export interface LedgerEntry {
  index: number;
  timestamp: string;
  action: string;          // BUY | SELL | HOLD | REBALANCE
  token: string;
  amountUsd: number;
  reasoning: string;
  sentimentScore?: number;
  regime?: string;
  outcome: 'executed' | 'blocked' | 'simulated';
  txHash?: string;         // execution tx (on-chain trade)
  prevHash: string;
  hash: string;
}

export interface AnchorRecord {
  root: string;
  entryIndex: number;
  txHash: string;
  at: string;
  network: string;
}

const GENESIS = '0'.repeat(64);

export class DecisionLedger {
  private entries: LedgerEntry[] = [];
  private anchors: AnchorRecord[] = [];
  private pendingSinceAnchor = 0;

  private ledgerPath = path.join('logs', 'decision-ledger.json');
  private anchorPath = path.join('logs', 'decision-anchors.json');

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.ledgerPath)) this.entries = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf8'));
      if (fs.existsSync(this.anchorPath)) this.anchors = JSON.parse(fs.readFileSync(this.anchorPath, 'utf8'));
      logger.info(`Decision ledger loaded: ${this.entries.length} entries, ${this.anchors.length} anchors. Chain ${this.verify().valid ? 'VALID' : 'BROKEN'}.`);
    } catch (error: any) {
      logger.error(`Failed to load decision ledger: ${error.message}`);
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.ledgerPath, JSON.stringify(this.entries, null, 2));
      fs.writeFileSync(this.anchorPath, JSON.stringify(this.anchors, null, 2));
    } catch (error: any) {
      logger.error(`Failed to save decision ledger: ${error.message}`);
    }
  }

  private computeHash(e: Omit<LedgerEntry, 'hash'>): string {
    const canonical = [
      e.index, e.timestamp, e.action, e.token,
      e.amountUsd, e.reasoning, e.sentimentScore ?? '', e.regime ?? '',
      e.outcome, e.txHash ?? '', e.prevHash
    ].join('|');
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Append a decision to the chain and return its hash.
   */
  public record(data: {
    action: string;
    token: string;
    amountUsd: number;
    reasoning: string;
    sentimentScore?: number;
    regime?: string;
    outcome: 'executed' | 'blocked' | 'simulated';
    txHash?: string;
  }): string {
    const index = this.entries.length;
    const prevHash = index === 0 ? GENESIS : this.entries[index - 1].hash;
    const base: Omit<LedgerEntry, 'hash'> = {
      index,
      timestamp: new Date().toISOString(),
      action: data.action,
      token: data.token,
      amountUsd: data.amountUsd,
      reasoning: data.reasoning,
      sentimentScore: data.sentimentScore,
      regime: data.regime,
      outcome: data.outcome,
      txHash: data.txHash,
      prevHash
    };
    const hash = this.computeHash(base);
    const entry: LedgerEntry = { ...base, hash };
    this.entries.push(entry);
    this.pendingSinceAnchor += 1;
    this.save();
    logger.info(`Ledger #${index} ${data.action} ${data.token} (${data.outcome}) hash=${hash.slice(0, 12)}…`);
    return hash;
  }

  public get root(): string {
    return this.entries.length === 0 ? GENESIS : this.entries[this.entries.length - 1].hash;
  }

  public get length(): number {
    return this.entries.length;
  }

  public get hasPendingAnchor(): boolean {
    return this.pendingSinceAnchor > 0;
  }

  /**
   * Recompute the whole chain and confirm no entry was tampered with.
   */
  public verify(): { valid: boolean; brokenAt?: number } {
    let prevHash = GENESIS;
    for (const e of this.entries) {
      if (e.prevHash !== prevHash) return { valid: false, brokenAt: e.index };
      const { hash, ...rest } = e;
      if (this.computeHash(rest) !== hash) return { valid: false, brokenAt: e.index };
      prevHash = e.hash;
    }
    return { valid: true };
  }

  /**
   * Anchor the current root hash on-chain. `anchorFn` performs the actual
   * commit (live: ERC-8004 attestation via TWAK; paper: simulated tx hash).
   */
  public async anchor(anchorFn: (root: string) => Promise<string>): Promise<AnchorRecord | null> {
    if (this.pendingSinceAnchor === 0 || this.entries.length === 0) return null;
    const root = this.root;
    try {
      const txHash = await anchorFn(root);
      const record: AnchorRecord = {
        root,
        entryIndex: this.entries.length - 1,
        txHash,
        at: new Date().toISOString(),
        network: config.x402Network
      };
      this.anchors.unshift(record);
      if (this.anchors.length > 50) this.anchors.pop();
      this.pendingSinceAnchor = 0;
      this.save();
      logger.info(`Anchored ledger root ${root.slice(0, 12)}… on-chain. Tx: ${txHash}`);
      return record;
    } catch (error: any) {
      logger.error(`Failed to anchor ledger root: ${error.message}`);
      return null;
    }
  }

  /**
   * Public proof object for the dashboard / external verifiers.
   */
  public getProof() {
    const v = this.verify();
    return {
      length: this.entries.length,
      root: this.root,
      verified: v.valid,
      brokenAt: v.brokenAt,
      lastAnchor: this.anchors[0] || null,
      anchors: this.anchors.slice(0, 5),
      entries: this.entries.slice(-15).reverse()
    };
  }
}
