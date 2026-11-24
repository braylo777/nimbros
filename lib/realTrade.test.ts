import test from "node:test";
import assert from "node:assert/strict";
import { memoryLedger } from "./realLedger.ts";
import { planTrade, type Agent, type Deps } from "./realTrade.ts";
import { SOL_MINT, type RealConfig } from "./realPolicy.ts";

const A = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const COIN = "DeepMint1111111111111111111111111111111111";
const agent: Agent = { id: "ag1", wallet: A };
const cfg = (o: Partial<RealConfig> = {}): RealConfig => ({ enabled: true, killed: false, allow: { [A]: { perTradeUsd: 25, dailyUsd: 75 } }, feeBps: 0, treasuryAddress: "", ...o });

/* SOL = $1, DEEP = $0.02 (so 1 SOL buys 50 DEEP at market) */
function deps(o: Partial<Deps> = {}): Deps & { built: number } {
  const d = {
    cfg: cfg(), ledger: memoryLedger(), now: () => 1_000_000, rand: () => "abcdef0123456789abcdef",
    solUsd: async () => 1,
    market: async () => ({ price: 0.02, liquidityUsd: 100_000 }),
    decimals: async () => 6,
    mint: async () => "good" as const,
    established: () => false,
    quote: async (_f: string, _t: string, amt: bigint) => ({ amountIn: amt, amountOut: (amt / 1000n) * 49n, insufficient: false, router: { spend: amt } }), // 1 SUI (1e9) -> 49 DEEP (49e6): ~2% cost
    built: 0,
    buildAndSimulate: async (r: unknown, address: string) => {
      d.built++;
      const spend = (r as { spend: bigint }).spend;
      return { tx: "{}", bytes: "AAEC", success: true, changes: [{ coinType: SOL_MINT, address, amount: String(-(spend + 2000n)) }, { coinType: COIN, address, amount: String((spend / 1000n) * 49n) }] };
    },
    ...o,
  };
  return d as Deps & { built: number };
}
const buy = (o: object = {}) => ({ side: "buy", coin: COIN, amount: "0.01", address: A, ...o });

test("a good buy returns an unsigned, simulated transaction with the numbers the agent needs", async () => {
  const d = deps();
  const p = await planTrade(d, agent, buy());
  assert.ok(p.ok, JSON.stringify(p));
  if (!p.ok) return;
  assert.equal(p.spend, "10000000");
  assert.equal(p.txBytes, "AAEC");                       // the exact bytes to sign
  assert.equal(p.spendDecimals, 9);
  assert.equal(p.receiveDecimals, 6);
  assert.equal(p.receiveCoin, COIN);
  assert.equal(p.minOutRaw, String((490000n * 99n) / 100n)); // 1% default slippage, floored
  assert.ok(p.usd > 0.0099 && p.usd < 0.0101);
  assert.equal(d.built, 1);
  assert.equal(await d.ledger.spentUsd(A, 0), p.usd); // reserved against the daily cap
  assert.equal(p.feeBps, 0); // no treasury configured in this fixture -> fee collection is off
});

test("the plan reports the platform fee rate straight from config, for the CLI to show before signing", async () => {
  const d = deps({ cfg: cfg({ feeBps: 50, treasuryAddress: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1" }) });
  const p = await planTrade(d, agent, buy());
  assert.ok(p.ok, JSON.stringify(p));
  if (p.ok) assert.equal(p.feeBps, 50);
});

test("cheap gates fire before any network work: off, killed, not allowed, not linked", async () => {
  const c = async (cfgO: Partial<RealConfig>, ag = agent, r = buy()) => { const d = deps({ cfg: cfg(cfgO) }); const p = await planTrade(d, ag, r); assert.equal(d.built, 0); return p.ok ? "ok" : `${p.status}:${p.code}`; };
  assert.equal(await c({ enabled: false }), "503:OFF");
  assert.equal(await c({ killed: true }), "503:KILLED");
  assert.equal(await c({ allow: {} }), "403:NOT_ALLOWED");
  assert.equal(await c({}, { ...agent, wallet: undefined }), "403:NOT_LINKED");
});

test("caps use the dollar size, and the daily cap counts what earlier builds already reserved", async () => {
  const d = deps();
  const big = await planTrade(d, agent, buy({ amount: "26" })); // 26 SUI = $26 > $25
  assert.ok(!big.ok && big.code === "OVER_TRADE_CAP");
  for (let i = 0; i < 3; i++) { d.rand = () => `id${i}`.padEnd(12, "0"); assert.ok((await planTrade(d, agent, buy({ amount: "25" }))).ok); }
  const over = await planTrade(d, agent, buy({ amount: "1" }));
  assert.ok(!over.ok && over.code === "OVER_DAILY_CAP"); // $75 already reserved
  d.now = () => 1_000_000 + 86_400_001; // a day later the window has moved on
  assert.ok((await planTrade(d, agent, buy({ amount: "1" }))).ok);
});

test("input validation", async () => {
  const c = async (r: object) => { const p = await planTrade(deps(), agent, r); return p.ok ? "ok" : p.code; };
  assert.equal(await c({ side: "hold", coin: COIN, amount: "1", address: A }), "BAD_REQUEST");
  assert.equal(await c(buy({ coin: "nope" })), "BAD_REQUEST");
  assert.equal(await c(buy({ address: "abc" })), "BAD_REQUEST");
  assert.equal(await c(buy({ amount: "-1" })), "BAD_AMOUNT");
  assert.equal(await c(buy({ amount: "0.0000000001" })), "BAD_AMOUNT"); // more than 9 decimals of SOL
  assert.equal(await c(buy({ coin: SOL_MINT })), "BAD_COIN");
});

test("refuses on no price, no route, thin pool, high impact, unlocked mint, or a bad simulation", async () => {
  const c = async (o: Partial<Deps>, r = buy()) => { const d = deps(o); const p = await planTrade(d, agent, r); return p.ok ? "ok" : p.code; };
  assert.equal(await c({ market: async () => null }), "NO_PRICE");
  assert.equal(await c({ solUsd: async () => null }), "NO_PRICE");
  assert.equal(await c({ quote: async () => null }), "NO_ROUTE");
  assert.equal(await c({ quote: async (_f, _t, a) => ({ amountIn: a, amountOut: 1n, insufficient: true, router: {} }) }), "NO_ROUTE");
  assert.equal(await c({ market: async () => ({ price: 0.02, liquidityUsd: 5_000 }) }), "THIN_POOL");
  assert.equal(await c({ quote: async (_f, _t, a) => ({ amountIn: a, amountOut: (a / 1000n) * 30n, insufficient: false, router: {} }) }), "HIGH_IMPACT"); // 40% worse than market
  assert.equal(await c({ mint: async () => "warn" }), "MINT_NOT_LOCKED");
  assert.equal(await c({ buildAndSimulate: async (_r, address) => ({ tx: "{}", bytes: "AAEC", success: true, changes: [{ coinType: SOL_MINT, address, amount: "-90000000" }, { coinType: COIN, address, amount: "490000" }] }) }), "OVERSPEND");
  assert.equal(await c({ buildAndSimulate: async () => ({ tx: "{}", bytes: "", success: false, changes: undefined }) }), "SIM_FAILED");
});

test("nothing is reserved when a plan is refused", async () => {
  const d = deps({ mint: async () => "warn" });
  await planTrade(d, agent, buy());
  assert.equal(await d.ledger.spentUsd(A, 0), 0);
});

test("a sell is sized in the coin, skips the mint and liquidity gate, and still simulates", async () => {
  const d = deps({
    quote: async (_f, _t, a) => ({ amountIn: a, amountOut: (a * 20n * 98n) / 100n, insufficient: false, router: {} }), // 1 DEEP (1e6) -> 0.0196 SUI
    mint: async () => { throw new Error("mint check must not run for sells"); },
    market: async () => ({ price: 0.02, liquidityUsd: 100 }),
    buildAndSimulate: async (_r, address) => ({ tx: "{}", bytes: "AAEC", success: true, changes: [{ coinType: COIN, address, amount: "-1000000" }, { coinType: SOL_MINT, address, amount: "19600000" }] }),
  });
  const p = await planTrade(d, agent, { side: "sell", coin: COIN, amount: "1", address: A });
  assert.ok(p.ok, JSON.stringify(p));
});

test("an established coin skips the mint-lock test (but still faces the liquidity and impact gates); a build that throws is a clean refusal", async () => {
  const warn = deps({ mint: async () => "warn", established: () => true });
  assert.ok((await planTrade(warn, agent, buy())).ok);
  const thin = deps({ established: () => true, market: async () => ({ price: 0.02, liquidityUsd: 5_000 }) });
  const p = await planTrade(thin, agent, buy());
  assert.ok(!p.ok && p.code === "THIN_POOL");
  const boom = deps({ buildAndSimulate: async () => { throw new Error("Insufficient balance of A for owner B"); } });
  const q = await planTrade(boom, agent, buy());
  assert.ok(!q.ok && q.code === "BUILD_FAILED" && q.status === 422 && /doesn't hold enough/.test(q.message));
  assert.equal(await boom.ledger.spentUsd(A, 0), 0); // nothing reserved
});
