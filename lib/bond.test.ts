import test from "node:test";
import assert from "node:assert/strict";
import { bondGate, emptyBond, requiredBondRaw, slash, SLASH_BPS, type BondState } from "./bond.ts";

const NMBR_DEC = 9;
const TOKEN = "0x" + "c".repeat(64) + "::nmbr::NMBR";

test("bond size scales with the agent's own daily cap, at the token's price", () => {
  // $75/day cap, $NMBR at $0.005 -> 15,000 NMBR
  assert.equal(requiredBondRaw(75, 0.005, NMBR_DEC), 15_000n * 10n ** 9n);
  // double the cap, double the bond
  assert.equal(requiredBondRaw(150, 0.005, NMBR_DEC), 30_000n * 10n ** 9n);
  // a pricier token means fewer tokens for the same coverage
  assert.equal(requiredBondRaw(75, 0.05, NMBR_DEC), 1_500n * 10n ** 9n);
});

test("bond rounds up: a bond one unit short is not a bond", () => {
  const r = requiredBondRaw(1, 3, 0); // 0.333… tokens, zero decimals
  assert.equal(r, 1n);
});

test("an unknown price or a nonsense cap yields no bond figure, so the caller must refuse", () => {
  assert.equal(requiredBondRaw(75, null, NMBR_DEC), null);
  assert.equal(requiredBondRaw(75, 0, NMBR_DEC), null);
  assert.equal(requiredBondRaw(0, 0.005, NMBR_DEC), null);
  assert.equal(requiredBondRaw(-75, 0.005, NMBR_DEC), null);
  assert.equal(requiredBondRaw(75, 0.005, -1), null);
});

test("the worst breaches take the whole bond; lesser ones take their published share", () => {
  const posted: BondState = { postedRaw: 1_000n, slashedRaw: 0n };
  assert.equal(slash(posted, "SIM_MISMATCH").toInsuranceRaw, 1_000n);
  assert.equal(slash(posted, "KILL_IGNORED").toInsuranceRaw, 1_000n);
  assert.equal(slash(posted, "WASH").toInsuranceRaw, 500n);
  assert.equal(slash(posted, "CAP_BREACH").toInsuranceRaw, 250n);
});

test("slashing moves value out of the bond and records it; it never takes more than is posted", () => {
  let s: BondState = { postedRaw: 1_000n, slashedRaw: 0n };
  const first = slash(s, "CAP_BREACH");
  s = first.state;
  assert.deepEqual(s, { postedRaw: 750n, slashedRaw: 250n });
  // repeat offences keep taking from what's left, and can't overdraw
  const second = slash(s, "SIM_MISMATCH");
  assert.equal(second.toInsuranceRaw, 750n);
  assert.deepEqual(second.state, { postedRaw: 0n, slashedRaw: 1_000n });
  // nothing left to take
  assert.equal(slash(second.state, "SIM_MISMATCH").toInsuranceRaw, 0n);
});

test("an empty bond can't be slashed into negative territory", () => {
  const r = slash(emptyBond(), "SIM_MISMATCH");
  assert.equal(r.toInsuranceRaw, 0n);
  assert.deepEqual(r.state, emptyBond());
});

test("with no $NMBR token configured, bonding is not enforced at all (today's case)", () => {
  const v = bondGate({ bondToken: "", dailyUsdCap: 75, nmbrUsd: null, decimals: NMBR_DEC, state: emptyBond() });
  assert.ok(v.ok);
});

test("once a bond token exists, trading needs a big enough bond", () => {
  const need = requiredBondRaw(75, 0.005, NMBR_DEC)!;
  const short = bondGate({ bondToken: TOKEN, dailyUsdCap: 75, nmbrUsd: 0.005, decimals: NMBR_DEC, state: { postedRaw: need - 1n, slashedRaw: 0n } });
  assert.equal(short.ok, false);
  if (!short.ok) assert.equal(short.code, "BOND_TOO_SMALL");

  const exact = bondGate({ bondToken: TOKEN, dailyUsdCap: 75, nmbrUsd: 0.005, decimals: NMBR_DEC, state: { postedRaw: need, slashedRaw: 0n } });
  assert.ok(exact.ok);
  if (exact.ok) assert.equal(exact.requiredRaw, need);
});

test("a slashed agent stops qualifying until it tops the bond back up", () => {
  const need = requiredBondRaw(75, 0.005, NMBR_DEC)!;
  const after = slash({ postedRaw: need, slashedRaw: 0n }, "CAP_BREACH").state;
  const v = bondGate({ bondToken: TOKEN, dailyUsdCap: 75, nmbrUsd: 0.005, decimals: NMBR_DEC, state: after });
  assert.equal(v.ok, false);
});

test("a bond token with no readable price fails closed, never open", () => {
  const v = bondGate({ bondToken: TOKEN, dailyUsdCap: 75, nmbrUsd: null, decimals: NMBR_DEC, state: { postedRaw: 10n ** 30n, slashedRaw: 0n } });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.code, "NO_BOND_PRICE");
});

test("every slash reason has a share that is a real percentage of the bond", () => {
  for (const [k, v] of Object.entries(SLASH_BPS)) {
    assert.ok(v > 0 && v <= 10_000, `${k} = ${v}`);
  }
});
