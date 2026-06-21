export interface TokenInfo {
  symbol: string;
  name?: string;
  address?: string; // Optional contract address if specific resolution is needed
}

// 149 Eligible tokens from competition rules + BNB (default gas/trading pair asset)
export const ELIGIBLE_TOKEN_SYMBOLS = new Set([
  'BNB', // Native gas and core trading asset
  'ETH', 'USDT', 'USDC', 'XRP', 'TRX', 'DOGE', 'ZEC', 'ADA', 'LINK', 'BCH', 
  'DAI', 'TON', 'USD1', 'USDe', 'M', 'LTC', 'AVAX', 'SHIB', 'XAUt', 'WLFI', 
  'H', 'DOT', 'UNI', 'ASTER', 'DEXE', 'USDD', 'ETC', 'AAVE', 'ATOM', 'U', 
  'STABLE', 'FIL', 'INJ', 'NIGHT', 'FET', 'TUSD', 'BONK', 'PENGU', 'CAKE', 
  'SIREN', 'LUNC', 'ZRO', 'KITE', 'FDUSD', 'BEAT', 'PIEVERSE', 'BTT', 'NFT', 
  'EDGE', 'FLOKI', 'LDO', 'B', 'FF', 'PENDLE', 'NEX', 'STG', 'AXS', 'TWT', 
  'HOME', 'RAY', 'COMP', 'GWEI', 'XCN', 'GENIUS', 'XPL', 'BAT', 'SKYAI', 
  'APE', 'IP', 'SFP', 'TAG', 'NXPC', 'AB', 'SAHARA', '1INCH', 'CHEEMS', 
  'BANANAS31', 'RIVER', 'MYX', 'RAVE', 'SNX', 'FORM', 'LAB', 'HTX', 'USDf', 
  'CTM', 'BDX', 'SLX', 'UB', 'DUCKY', 'FRAX', 'BILL', 'WFI', 'KOGE', 'ALE', 
  'FRXUSD', 'USDF', 'GOMINING', 'VCNT', 'GUA', 'DUSD', 'SMILEK', '0G', 'BEAM', 
  'MY', 'SOON', 'REAL', 'Q', 'AIOZ', 'ZIG', 'YFI', 'TAC', 'LISUSD', 'CYS', 
  'ZAMA', 'TRIA', 'HUMA', 'PLUME', 'ZIL', 'XPR', 'ZETA', 'BABYDOGE', 'NILA', 
  'ROSE', 'VELO', 'UAI', 'BRETT', 'OPEN', 'BSB', 'TOSHI', 'BAS', 'ACH', 
  'AXL', 'LUR', 'ELF', 'KAVA', 'APR', 'IRYS', 'EURI', 'XUSD', 'BARD', 'DUSK', 
  'SUSHI', 'PEAQ', 'COAI', 'BDCA', 'XAUM'
]);

// BEP-20 contract addresses on BSC for explicit swap routing. The TWAK swap router
// only resolves a few symbols natively (e.g. USDT); everything else must be passed as
// a contract address. Every address below was verified live via the TWAK CLI quote
// (BNB -> <address> returned the expected token symbol), so routing is correct.
export const BSC_TOKEN_ADDRESSES: Record<string, string> = {
  'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  // Stables / pegged
  'USDT': '0x55d398326f99059fF775485246999027B3197955',
  'USDC': '0x8AC76a51cc950d9822D68b83FE1ad97B32CD580d',
  'FDUSD': '0xc5f0f7b0c024d34c4958c116757b3b9b91a75662',
  'DAI': '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
  'USDe': '0x992B19CcFF77dcbC4Ec0A87B1143890f6580f498',
  // Verified directional (Binance-Peg) tokens with live BSC routes
  'ETH': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  'CAKE': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  'XRP': '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE',
  'ADA': '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47',
  'DOGE': '0xbA2aE424d960c26247Dd6c32edC70B295c744C43',
  'LTC': '0x4338665CBB7B2485A8855A139b75D5e34AB0DB94',
  'LINK': '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD',
  'DOT': '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402',
  'AVAX': '0x1CE0c2827e2eF14D5C4f29a091d735A204794041',
  'UNI': '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1',
  'AAVE': '0xfb6115445Bff7b52FeB98650C87f44907E58f802',
  'ATOM': '0x0Eb3a705fc54725037CC9e008bDede697f62F335',
  'BCH': '0x8fF795a6F4D97E7887C79beA79aba5cc76444aDf',
  'FIL': '0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153',
};

// Stablecoins / pegged assets — eligible, but not momentum-trading candidates.
// Used as settlement/quote assets, never as directional BUY targets.
export const STABLE_OR_PEGGED = new Set([
  'USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'USD1', 'USDD', 'FRAX', 'FRXUSD',
  'USDF', 'USDF', 'DUSD', 'LISUSD', 'EURI', 'XUSD', 'USDf', 'M', 'STABLE', 'BILL',
  'XAUT', 'XAUM' // gold-pegged
].map(s => s.toUpperCase()));

/**
 * Check if a token symbol is part of the eligible tokens allowed in the BNB Hack competition
 * @param symbol Token symbol (case-insensitive)
 * @returns boolean
 */
export function isEligible(symbol: string): boolean {
  return ELIGIBLE_TOKEN_SYMBOLS.has(symbol.toUpperCase());
}

/** True for stablecoins / pegged assets that should not be momentum-traded. */
export function isStable(symbol: string): boolean {
  return STABLE_OR_PEGGED.has(symbol.toUpperCase());
}

/**
 * The directional trading universe: all eligible tokens except BNB (gas/quote)
 * and stable/pegged assets. This is the full candidate set the agent scans.
 */
export function getTradableUniverse(): string[] {
  return getEligibleTokens().filter(s => s.toUpperCase() !== 'BNB' && !isStable(s));
}

/**
 * The *executable* universe for LIVE trading: eligible, non-stable tokens that have a
 * verified BSC contract route (present in BSC_TOKEN_ADDRESSES). The agent only buys
 * tokens it can actually swap into on-chain, so it never wastes cycles on unroutable
 * symbols. Expand this by adding more verified addresses to BSC_TOKEN_ADDRESSES.
 */
export function getRoutableUniverse(): string[] {
  return getEligibleTokens().filter(s => {
    const u = s.toUpperCase();
    return u !== 'BNB' && !isStable(u) && getTokenAddress(u) !== undefined;
  });
}

/**
 * Returns list of all eligible token symbols
 */
export function getEligibleTokens(): string[] {
  return Array.from(ELIGIBLE_TOKEN_SYMBOLS);
}

/**
 * Get contract address for common tokens on BSC to assist swapping / balances
 */
export function getTokenAddress(symbol: string): string | undefined {
  return BSC_TOKEN_ADDRESSES[symbol.toUpperCase()];
}
