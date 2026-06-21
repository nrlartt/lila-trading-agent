import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

export interface Config {
  twakAccessId: string;
  twakHmacSecret: string;
  twakWalletPassword?: string;
  cmcMcpApiKey?: string;
  cmcMcpUrl: string;
  groqApiKey: string;
  groqModel: string;
  agentMode: 'paper' | 'live';
  x402Enabled: boolean;
  x402DataEndpoint?: string;
  // x402 seller (Alpha-as-a-Service): LILA sells its own intelligence
  x402SellEnabled: boolean;
  x402SellPriceUsd: number;
  x402Network: string;
  x402FacilitatorUrl?: string;
  usdcAddress: string;
  usdcDecimals: number;
  publicBaseUrl: string;
  tradeIntervalMs: number;
  startingBalanceUsd: number;
  maxDrawdownPct: number;
  dailyLimitUsd: number;
  maxTradeUsd: number;
  slippageBps: number;
  bscRpcUrl: string;
  bscChainId: number;
  port: number;
  dashboardWsPort: number;
}

const getEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config: Config = {
  twakAccessId: getEnv('TWAK_ACCESS_ID', 'demo_access_id'),
  twakHmacSecret: getEnv('TWAK_HMAC_SECRET', 'demo_secret'),
  twakWalletPassword: process.env.TWAK_WALLET_PASSWORD,
  cmcMcpApiKey: process.env.CMC_MCP_API_KEY,
  cmcMcpUrl: getEnv('CMC_MCP_URL', 'https://mcp.coinmarketcap.com/mcp'),
  groqApiKey: getEnv('GROQ_API_KEY', 'demo_groq_key'),
  groqModel: getEnv('GROQ_MODEL', 'llama-3.3-70b-versatile'),
  agentMode: (process.env.AGENT_MODE || 'paper') as 'paper' | 'live',
  x402Enabled: (process.env.X402_ENABLED || 'true').toLowerCase() === 'true',
  x402DataEndpoint: process.env.X402_DATA_ENDPOINT,
  x402SellEnabled: (process.env.X402_SELL_ENABLED || 'true').toLowerCase() === 'true',
  x402SellPriceUsd: parseFloat(getEnv('X402_SELL_PRICE_USD', '0.01')),
  x402Network: getEnv('X402_NETWORK', 'bsc'),
  x402FacilitatorUrl: process.env.X402_FACILITATOR_URL,
  usdcAddress: getEnv('USDC_ADDRESS', '0x8AC76a51cc950d9822D68b83FE1ad97B32CD580d'),
  usdcDecimals: parseInt(getEnv('USDC_DECIMALS', '18'), 10),
  publicBaseUrl: getEnv('PUBLIC_BASE_URL', `http://localhost:${process.env.PORT || '3000'}`),
  tradeIntervalMs: parseInt(getEnv('TRADE_INTERVAL_MS', '300000'), 10),
  startingBalanceUsd: parseFloat(getEnv('STARTING_BALANCE_USD', '10')),
  maxDrawdownPct: parseFloat(getEnv('MAX_DRAWDOWN_PCT', '10')),
  dailyLimitUsd: parseFloat(getEnv('DAILY_LIMIT_USD', '10')),
  maxTradeUsd: parseFloat(getEnv('MAX_TRADE_USD', '5')),
  slippageBps: parseInt(getEnv('SLIPPAGE_BPS', '100'), 10),
  bscRpcUrl: getEnv('BSC_RPC_URL', 'https://bsc-dataseed.binance.org'),
  bscChainId: parseInt(getEnv('BSC_CHAIN_ID', '56'), 10),
  port: parseInt(getEnv('PORT', '3000'), 10),
  dashboardWsPort: parseInt(getEnv('DASHBOARD_WS_PORT', '3001'), 10),
};

// Validate critical parameters for Live mode
if (config.agentMode === 'live') {
  if (!config.twakWalletPassword) {
    throw new Error('TWAK_WALLET_PASSWORD is required in live trading mode.');
  }
  if (config.twakAccessId === 'demo_access_id' || config.twakHmacSecret === 'demo_secret') {
    throw new Error('Valid TWAK_ACCESS_ID and TWAK_HMAC_SECRET are required in live trading mode.');
  }
  if (config.groqApiKey === 'demo_groq_key') {
    throw new Error('Valid GROQ_API_KEY is required in live trading mode.');
  }
}
