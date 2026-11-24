import test from "node:test";
import assert from "node:assert/strict";
import { checkRealPolicy, checkSwapSim, clampSlippage, minOutFor, parseAllowlist, safetyGate, toRaw, SOL_MINT, type RealConfig } from "./realPolicy.ts";

const A = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", B = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const DEEP = "DeepMint1111111111111111111111111111111111";
const cfg = (o: Partial<RealConfig> = {}): RealConfig => ({ enabled: true, killed: false, allow: { [A]: { perTradeUsd: 25, dailyUsd: 75 } }, feeBps: 0, treasuryAddress: "", ...o });
const pol = (o: object = {}, c: Partial<RealConfig> = {}) => checkRealPolicy({ cfg: cfg(c), address: A, linkedWallet: A, usd: 20, spentUsd24h: 0, ...o });
const code = (v: { ok: boolean; code?: string }) => (v.ok ? "ok" : v.code);

test("parseAllowlist: JSON with caps, plain comma list, and junk dropped", () => {
  assert.deepEqual(parseAllowlist(JSON.stringify({ [A]: { perTradeUsd: 10, dailyUsd: 30 }, "0x1": {} })), { [A]: { perTradeUsd: 10, dailyUsd: 30 } });
  assert.deepEqual(parseAllowlist(`${A}, ${B},nope`), { [A]: { perTradeUsd: 25, dailyUsd: 75 }, [B]: { perTradeUsd: 25, dailyUsd: 75 } });
  assert.deepEqual(parseAllowlist(JSON.stringify({ [A]: { perTradeUsd: 99999 } })), { [A]: { perTradeUsd: 25, dailyUsd: 75 } }); // absurd cap ignored
  assert.deepEqual(parseAllowlist(undefined), {});
});
test("policy: off, killed, allowlist, wallet link, caps — each with its own code", () => {
  assert.equal(code(pol()), "ok");
  assert.equal(code(pol({}, { enabled: false })), "OFF");
  assert.equal(code(pol({}, { killed: true })), "KILLED");
  assert.equal(code(pol({ address: B })), "NOT_ALLOWED");
  assert.equal(code(pol({ linkedWallet: undefined })), "NOT_LINKED");
  assert.equal(code(pol({ linkedWallet: B })), "NOT_LINKED");
  assert.equal(code(pol({ usd: 25.01 })), "OVER_TRADE_CAP");
  assert.equal(code(pol({ usd: 25 })), "ok");
  assert.equal(code(pol({ usd: 20, spentUsd24h: 60 })), "OVER_DAILY_CAP");
  assert.equal(code(pol({ usd: 15, spentUsd24h: 60 })), "ok");
  assert.equal(code(pol({ usd: 0 })), "BAD_AMOUNT");
  assert.equal(code(pol({ usd: NaN })), "BAD_AMOUNT");
});
test("toRaw is exact and refuses anything odd", () => {
  assert.equal(toRaw("1.5", 9), 1_500_000_000n);
  assert.equal(toRaw("0.000000001", 9), 1n);
  assert.equal(toRaw(2, 6), 2_000_000n);
  for (const bad of ["0", "-1", "1e3", "1.0000000001", "abc", "", "1,5", null, 0]) assert.equal(toRaw(bad as string, 9), null, String(bad));
});
test("slippage is clamped and minOut floors (never rounds up)", () => {
  assert.equal(clampSlippage(5), 10);
  assert.equal(clampSlippage(9999), 300);
  assert.equal(clampSlippage("x"), 100);
  assert.equal(minOutFor(25_746_856n, 100), 25_489_387n); // 25,746,856 x 0.99 = 25,489,387.44 -> floor
  assert.equal(minOutFor(1n, 100), 0n);
});
const ch = (coinType: string, amount: string, address = A) => ({ coinType, address, amount });
const sim = (o: object) => checkSwapSim({ success: true, changes: [], address: A, spendCoin: SOL_MINT, spendRaw: 500_000_000n, receiveCoin: DEEP, minOutRaw: 25_000_000n, ...o });
test("swap sim guard: the exact expected swap passes, and each way it could go wrong is refused", () => {
  const good = [ch(SOL_MINT, "-502754376"), ch(DEEP, "25746856")];
  const ok = sim({ changes: good });
  assert.ok(ok.ok);
  if (ok.ok) { assert.equal(ok.receivedRaw, 25_746_856n); assert.equal(ok.gasRaw, 2_754_376n); }
  const c = (changes: object[], o: object = {}) => code(sim({ changes, ...o }));
  assert.equal(c([], { success: false }), "SIM_FAILED");
  assert.equal(c(good, { changes: undefined }), "NO_DATA");
  assert.equal(c([ch(SOL_MINT, "-502754376"), ch(DEEP, "24000000")]), "UNDERDELIVERY");
  assert.equal(c([ch(SOL_MINT, "-600000000"), ch(DEEP, "25746856")]), "OVERSPEND");
  assert.equal(c([ch(SOL_MINT, "-500000000")]), "NO_RECEIVE");
  assert.equal(c([ch(SOL_MINT, "-502754376"), ch(DEEP, "25746856"), ch("Other11111111111111111111111111111111111", "-5")]), "UNEXPECTED_ASSET");
  assert.equal(c([ch(SOL_MINT, "-502754376"), ch(DEEP, "25746856", B)]), "NO_RECEIVE"); // the coin went to someone else
  assert.equal(c([ch(SOL_MINT, "+502754376"), ch(DEEP, "25746856")]), "UNEXPECTED_DIRECTION"); // SOL would go UP
});
test("swap sim guard: selling a token for SOL; balance changes are one net line per coin", () => {
  const sell = (extra: { coinType: string; address: string; amount: string }[]) => checkSwapSim({ success: true, address: A, spendCoin: DEEP, spendRaw: 10_000_000n, receiveCoin: SOL_MINT, minOutRaw: 100n, changes: [ch(DEEP, "-10000000"), ch(SOL_MINT, "190000000"), ...extra] });
  assert.ok(sell([]).ok);
  assert.equal(code(sell([ch("Other11111111111111111111111111111111111", "-1")])), "UNEXPECTED_ASSET");
  assert.equal(code(checkSwapSim({ success: true, address: A, spendCoin: DEEP, spendRaw: 10_000_000n, receiveCoin: SOL_MINT, minOutRaw: 100n, changes: [ch(DEEP, "-20000000"), ch(SOL_MINT, "190000000")] })), "OVERSPEND");
});
test("safety gate refuses thin pools, big impact, and unlocked or unknown mint", () => {
  assert.equal(code(safetyGate({ liquidityUsd: 50_000, impactPct: 1, mint: "good" })), "ok");
  assert.equal(code(safetyGate({ liquidityUsd: 9_999, impactPct: 1, mint: "good" })), "THIN_POOL");
  assert.equal(code(safetyGate({ liquidityUsd: 50_000, impactPct: 3.5, mint: "good" })), "HIGH_IMPACT");
  assert.equal(code(safetyGate({ liquidityUsd: 50_000, impactPct: 1, mint: "warn" })), "MINT_NOT_LOCKED");
  assert.equal(code(safetyGate({ liquidityUsd: 50_000, impactPct: 1, mint: "unknown" })), "MINT_NOT_LOCKED");
  assert.equal(code(safetyGate({ liquidityUsd: 50_000, impactPct: 1, mint: "warn", allowUnlockedMint: true })), "ok");
});
