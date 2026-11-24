/* Every chain NimBros knows. Solana is the home chain; the rest are EVM chains where a launch is a plain contract deployment signed by the launcher's
   own wallet. `geckoNetwork` and `dexscreener` are the ids those public data sources use; `rpcs` are public read endpoints (tried in order) used only to
   estimate gas and simulate; the wallet itself sends the transaction through its own node. */
export type ChainId = "solana" | "bsc" | "ethereum" | "polygon" | "avalanche";

export interface Chain {
  id: ChainId;
  name: string;
  kind: "solana" | "evm";
  evmId?: number;
  native: string;
  nativeDecimals: number;
  geckoNetwork: string;
  dexscreener: string;
  explorer: string;
  rpcs?: string[];
  /** wrapped native token: the quote asset of most memecoin pools */
  wrapped?: string;
  /** rough cost of deploying the token, in native units, shown as an estimate only */
  launchGasHint?: number;
  color: string;
  /** the chain's logo (DexScreener's public chain icons) */
  logo: string;
}

export const CHAINS: Record<ChainId, Chain> = {
  solana: { id: "solana", name: "Solana", kind: "solana", native: "SOL", nativeDecimals: 9, geckoNetwork: "solana", dexscreener: "solana", explorer: "https://solscan.io", color: "#9945FF", logo: "" },
  bsc: { id: "bsc", name: "BNB Chain", kind: "evm", evmId: 56, native: "BNB", nativeDecimals: 18, geckoNetwork: "bsc", dexscreener: "bsc", explorer: "https://bscscan.com", rpcs: ["https://bsc-dataseed.bnbchain.org", "https://bsc.publicnode.com"], wrapped: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", launchGasHint: 0.0015, color: "#F0B90B", logo: "" },
  ethereum: { id: "ethereum", name: "Ethereum", kind: "evm", evmId: 1, native: "ETH", nativeDecimals: 18, geckoNetwork: "eth", dexscreener: "ethereum", explorer: "https://etherscan.io", rpcs: ["https://ethereum.publicnode.com", "https://eth.llamarpc.com"], wrapped: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", launchGasHint: 0.004, color: "#627EEA", logo: "" },
  polygon: { id: "polygon", name: "Polygon", kind: "evm", evmId: 137, native: "POL", nativeDecimals: 18, geckoNetwork: "polygon_pos", dexscreener: "polygon", explorer: "https://polygonscan.com", rpcs: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com"], wrapped: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", launchGasHint: 0.05, color: "#8247E5", logo: "" },
  avalanche: { id: "avalanche", name: "Avalanche", kind: "evm", evmId: 43114, native: "AVAX", nativeDecimals: 18, geckoNetwork: "avax", dexscreener: "avalanche", explorer: "https://snowtrace.io", rpcs: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"], wrapped: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", launchGasHint: 0.01, color: "#E84142", logo: "" },
};

for (const c of Object.values(CHAINS)) c.logo = `https://dd.dexscreener.com/ds-data/chains/${c.dexscreener}.png`;
export const CHAIN_LIST: Chain[] = Object.values(CHAINS);
export const EVM_CHAINS: Chain[] = CHAIN_LIST.filter((c) => c.kind === "evm");
export const isChainId = (v: unknown): v is ChainId => typeof v === "string" && v in CHAINS;
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const isEvmAddress = (v: unknown): v is string => typeof v === "string" && EVM_ADDRESS.test(v);
export const explorerTx = (c: Chain, hash: string) => `${c.explorer}/tx/${hash}`;
export const explorerAddress = (c: Chain, a: string) => `${c.explorer}/address/${a}`;
export const explorerToken = (c: Chain, a: string) => `${c.explorer}/token/${a}`;
