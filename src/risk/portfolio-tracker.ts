import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger';
import { config } from '../core/config';
import { WalletPortfolio } from '../execution/types';

interface TradeRecord {
  timestamp: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  amountUsd: number;
  amountToken: number;
  price: number;
  txHash?: string;
  reasoning?: string;
}

interface PortfolioSnapshot {
  timestamp: string;
  totalUsdValue: number;
  nativeBalance: string;
  tokens: Array<{
    symbol: string;
    balance: string;
    usdValue?: number;
  }>;
}

export class PortfolioTracker {
  private trades: TradeRecord[] = [];
  private history: PortfolioSnapshot[] = [];
  private purchasePrices: Record<string, number> = {}; // Tracks average cost basis for open positions
  
  private tradesFilePath = path.join('logs', 'trades.json');
  private historyFilePath = path.join('logs', 'portfolio-history.json');
  private purchasePricesFilePath = path.join('logs', 'purchase-prices.json');

  constructor() {
    this.loadState();
  }

  /**
   * Load history and trade logs from disk if they exist
   */
  private loadState(): void {
    try {
      if (fs.existsSync(this.tradesFilePath)) {
        this.trades = JSON.parse(fs.readFileSync(this.tradesFilePath, 'utf8'));
      }
      if (fs.existsSync(this.historyFilePath)) {
        this.history = JSON.parse(fs.readFileSync(this.historyFilePath, 'utf8'));
      }
      if (fs.existsSync(this.purchasePricesFilePath)) {
        this.purchasePrices = JSON.parse(fs.readFileSync(this.purchasePricesFilePath, 'utf8'));
      }
      logger.info(`State loaded: ${this.trades.length} trades, ${this.history.length} snapshots.`);
    } catch (error: any) {
      logger.error(`Failed to load state: ${error.message}`);
    }
  }

  /**
   * Save current state to disk
   */
  private saveState(): void {
    try {
      fs.writeFileSync(this.tradesFilePath, JSON.stringify(this.trades, null, 2));
      fs.writeFileSync(this.historyFilePath, JSON.stringify(this.history, null, 2));
      fs.writeFileSync(this.purchasePricesFilePath, JSON.stringify(this.purchasePrices, null, 2));
    } catch (error: any) {
      logger.error(`Failed to save state: ${error.message}`);
    }
  }

  /**
   * Track a new transaction and update position cost basis
   */
  public recordTrade(
    type: 'BUY' | 'SELL',
    symbol: string,
    amountUsd: number,
    amountToken: number,
    price: number,
    txHash?: string,
    reasoning?: string
  ): void {
    const trade: TradeRecord = {
      timestamp: new Date().toISOString(),
      type,
      symbol: symbol.toUpperCase(),
      amountUsd,
      amountToken,
      price,
      txHash,
      reasoning
    };

    this.trades.push(trade);

    const sym = symbol.toUpperCase();
    if (type === 'BUY') {
      // Update average entry price / cost basis
      const currentCost = this.purchasePrices[sym] || 0;
      this.purchasePrices[sym] = price; // In this simple model we track latest entry price as stop loss basis
    } else if (type === 'SELL') {
      // Remove or reduce position from cost basis
      delete this.purchasePrices[sym];
    }

    this.saveState();
    logger.info(`Recorded trade: ${type} ${amountToken} ${sym} for $${amountUsd.toFixed(2)} at $${price}`);
  }

  /**
   * Record a snapshot of current portfolio values
   */
  public recordSnapshot(portfolio: WalletPortfolio): void {
    const snapshot: PortfolioSnapshot = {
      timestamp: new Date().toISOString(),
      totalUsdValue: portfolio.totalUsdValue || parseFloat(portfolio.nativeBalance) * 300, // Fallback calculation
      nativeBalance: portfolio.nativeBalance,
      tokens: (portfolio.tokens || []).map(t => ({
        symbol: t.symbol,
        balance: t.balance,
        usdValue: t.usdValue
      }))
    };

    this.history.push(snapshot);
    
    // Keep history bounded to last 1000 snapshots to avoid bloating file
    if (this.history.length > 1000) {
      this.history.shift();
    }

    this.saveState();
  }

  /**
   * Get purchase price basis of a token
   */
  public getPurchasePrice(symbol: string): number | undefined {
    return this.purchasePrices[symbol.toUpperCase()];
  }

  /**
   * Calculate current metrics and statistics
   */
  public getStats(currentPortfolioValue: number) {
    const starting = config.startingBalanceUsd;
    const totalReturnUsd = currentPortfolioValue - starting;
    const totalReturnPct = (totalReturnUsd / starting) * 100;
    
    // Calculate win rate
    let wins = 0;
    let losses = 0;
    
    // Check realized trades (every BUY-SELL pair)
    // Simplify: count how many sells were executed above cost basis
    const sellTrades = this.trades.filter(t => t.type === 'SELL');
    sellTrades.forEach(sell => {
      // Find previous buy for this token
      const matchingBuy = [...this.trades]
        .reverse()
        .find(t => t.type === 'BUY' && t.symbol === sell.symbol && new Date(t.timestamp) < new Date(sell.timestamp));
        
      if (matchingBuy) {
        if (sell.price > matchingBuy.price) wins++;
        else losses++;
      }
    });

    const totalTrades = this.trades.length;
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

    return {
      startingBalance: starting,
      currentValue: currentPortfolioValue,
      totalReturnUsd,
      totalReturnPct,
      totalTrades,
      winRate,
      wins,
      losses,
      trades: this.trades.slice(-20), // Return last 20 trades
      history: this.history.slice(-50) // Return last 50 snapshots
    };
  }
}
