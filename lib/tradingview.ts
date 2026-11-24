/* TradingView's free embedded chart, for the established Solana assets that trade on
   exchanges TradingView carries. It shows that EXCHANGE's price, which can differ
   from the on-chain pool's. Memecoins and new pools are not on TradingView, so they
   only get our own chart.

   The mapping is keyed by the Solana mint address, NOT by ticker: tickers collide (any
   memecoin can call itself "SOL" or "BONK"). Each entry was checked against
   TradingView's symbol search and against the coin type GeckoTerminal reports. */

export interface TvSymbol { symbol: string; exchange: string }

const TV: Record<string, TvSymbol> = {
  "So11111111111111111111111111111111111111112": { symbol: "BINANCE:SOLUSDT", exchange: "Binance" },
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": { symbol: "BINANCE:JUPUSDT", exchange: "Binance" },
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": { symbol: "BINANCE:BONKUSDT", exchange: "Binance" },
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": { symbol: "BINANCE:WIFUSDT", exchange: "Binance" },
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": { symbol: "KUCOIN:POPCATUSDT", exchange: "KuCoin" },
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3": { symbol: "BINANCE:PYTHUSDT", exchange: "Binance" },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "BINANCE:RAYUSDT", exchange: "Binance" },
};

/** Coin types appear with and without leading zeros in the address part; compare on the trimmed form. */
export function normType(t: string): string {
  return t.trim(); // base58 mints are case-sensitive: the trimmed string IS the canonical form
}

const BY_NORM = new Map(Object.entries(TV).map(([k, v]) => [normType(k), v]));

export const tvSymbolFor = (contract: string): TvSymbol | null => BY_NORM.get(normType(contract)) ?? null;

export const TV_INTERVALS: Record<string, string> = { "1m": "1", "5m": "5", "15m": "15", "1H": "60", "4H": "240", "1D": "D" };

/** The embed URL. Every parameter is a fixed literal or comes from the maps above. */
export function tvEmbedUrl(symbol: string, interval: string): string {
  const p = new URLSearchParams({
    symbol,
    interval: TV_INTERVALS[interval] ?? "15",
    theme: "light",
    style: "1",
    locale: "en",
    timezone: "Etc/UTC",
    hidesidetoolbar: "1",
    symboledit: "0",
    saveimage: "0",
    withdateranges: "1",
    hide_legend: "0",
  });
  return `https://s.tradingview.com/widgetembed/?${p.toString()}`;
}
