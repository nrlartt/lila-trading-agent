export interface WalletAddress {
  chain: string;
  address: string;
}

export interface TokenHolding {
  symbol: string;
  balance: string;
  balanceRaw: string;
  usdValue?: number;
  decimals: number;
}

export interface WalletPortfolio {
  chain: string;
  nativeBalance: string;
  nativeBalanceRaw: string;
  nativeUsdValue?: number;
  tokens: TokenHolding[];
  totalUsdValue?: number;
}

export interface SwapQuote {
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOutEstimated: string;
  priceImpactPct?: number;
  slippagePct: number;
  route?: string;
  feeUsd?: number;
}

export interface SwapResult {
  success: boolean;
  txHash?: string;
  amountIn: string;
  amountOut: string;
  fromToken: string;
  toToken: string;
  error?: string;
  rawOutput?: string;
}

export interface CompetitionStatus {
  registered: boolean;
  walletAddress?: string;
  deadline?: string;
  error?: string;
}

export interface CompetitionRegisterResult {
  success: boolean;
  txHash?: string;
  error?: string;
}
