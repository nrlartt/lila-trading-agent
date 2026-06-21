import { DailyMarketOverviewData } from '../services/cmc/types';

export interface TokenSentiment {
  symbol: string;
  score: number; // -1.0 to 1.0
  impact: number; // 0.0 to 1.0
  rationale: string;
}

export interface MarketSentiment {
  overallScore: number; // -1.0 to 1.0
  narrativeSummary: string;
  tokens: TokenSentiment[];
}

export interface TradeDecision {
  action: 'BUY' | 'SELL' | 'HOLD';
  tokenSymbol: string;
  amountUsd: number;
  confidence: number; // 0.0 to 1.0
  reasoning: string;
  timestamp: string;
}

export interface MarketContext {
  overview: DailyMarketOverviewData;
  sentiment: MarketSentiment;
  currentPortfolioValueUsd: number;
}
