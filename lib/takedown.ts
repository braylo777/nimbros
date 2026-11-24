import { normType } from "./tradingview.ts";

/* Takedown list, kept in KV by the operator. A taken-down coin is hidden from the launch feed and can't be
   listed again; a taken-down SYMBOL can't be launched again through the build API. Nothing here can stop
   a coin that already exists on chain from trading; it only controls what NimBros lists and builds.
   Add:  wrangler kv key put --binding=FEEDS "takedown:coin:<normalized coin type>" 1
         wrangler kv key put --binding=FEEDS "takedown:sym:<SYMBOL>" 1                                    */
interface KV { get(k: string): Promise<string | null> }

export async function takenDown(kv: KV, a: { coinType?: string; symbol?: string }): Promise<boolean> {
  try {
    if (a.coinType && (await kv.get(`takedown:coin:${normType(a.coinType)}`))) return true;
    if (a.symbol && (await kv.get(`takedown:sym:${a.symbol.toUpperCase()}`))) return true;
    return false;
  } catch {
    return false; // a KV outage must not hide every coin
  }
}
