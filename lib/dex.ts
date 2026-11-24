/* Exchange names and logos. GeckoTerminal ids in, display names and logo URLs out.
   Logos come from DexScreener's public image host, and only for exchanges it really has one for (it serves a
   generic placeholder for the rest), so anything not listed gets a lettered badge instead. */

const NAMES: Record<string, string> = {
  "pump-fun": "pump.fun", pumpfun: "pump.fun", pumpswap: "PumpSwap", "letsbonk-fun": "bonk.fun", "raydium-launchlab": "LaunchLab", raydium: "Raydium", "raydium-clmm": "Raydium CLMM",
  "raydium-cp": "Raydium CPMM", moonshot: "Moonshot", moonit: "Moonit", meteora: "Meteora", "meteora-dbc": "Meteora DBC", "meteora-damm-v2": "Meteora DAMM", orca: "Orca", whirlpool: "Orca",
  "boop-fun": "Boop", "bags-fm": "Bags", heaven: "Heaven", wavebreak: "Wavebreak", zora: "Zora", stonkfun: "Stonk.fun", "daos-fun": "DAOS.fun", "token-mill": "Token Mill",
  "printr-v2": "Printr", "virtuals-solana": "Virtuals", fluxbeam: "FluxBeam", humidifi: "HumidiFi", "saros-amm": "Saros", "saros-dlmm": "Saros DLMM", defituna: "DefiTuna", byreal: "Byreal",
  dexlab: "DexLab", "clanker-solana": "Clanker", metadao: "MetaDAO", zerofi: "ZeroFi", manifest: "Manifest", "easya-kickstart": "EasyA Kickstart", "pancakeswap-v3-solana": "PancakeSwap",
};
const LOGO_ID: Record<string, string> = {
  "pump-fun": "pumpfun", pumpfun: "pumpfun", pumpswap: "pumpswap", "letsbonk-fun": "letsbonk", raydium: "raydium", "raydium-clmm": "raydium", "raydium-cp": "raydium", "raydium-launchlab": "raydium",
  moonshot: "moonshot", stonkfun: "stonkfun", meteora: "meteora", "meteora-dbc": "meteora", "meteora-damm-v2": "meteora", orca: "orca", whirlpool: "orca", fluxbeam: "fluxbeam",
};

export const dexName = (id: string): string => NAMES[id] ?? id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
export const dexLogoUrl = (id: string): string | null => (LOGO_ID[id] ? `https://dd.dexscreener.com/ds-data/dexes/${LOGO_ID[id]}.png` : null);
/** A steady tint for the lettered badge, so each exchange keeps its own colour. */
export const dexHue = (id: string): number => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/** Official sites, only for exchanges whose address we are sure of; the rest are shown without a link. */
const SITE: Record<string, string> = {
  "pump-fun": "https://pump.fun", pumpfun: "https://pump.fun", pumpswap: "https://pump.fun", "letsbonk-fun": "https://bonk.fun", "raydium-launchlab": "https://raydium.io/launchpad/",
  raydium: "https://raydium.io", "raydium-clmm": "https://raydium.io", "raydium-cp": "https://raydium.io", moonshot: "https://moonshot.com", meteora: "https://meteora.ag",
  "meteora-dbc": "https://meteora.ag", "meteora-damm-v2": "https://meteora.ag", orca: "https://www.orca.so", whirlpool: "https://www.orca.so", "boop-fun": "https://boop.fun",
};
export const dexUrl = (id: string): string | null => SITE[id] ?? null;
