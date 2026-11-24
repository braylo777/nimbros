import test from "node:test";
import assert from "node:assert/strict";
import { tokenFacts } from "./tokenIndex.ts";
import { getMintInfo, UNKNOWN_AUTHORITY } from "./solRpc.ts";
import { summarizeSafety } from "./safety.ts";

const M = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const jup = (o: object) => ({ id: M, decimals: 5, holderCount: 1000, totalSupply: 8.8e13, audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 31.5 }, launchpad: "pump.fun", ...o });
const mock = (routes: Record<string, () => Response>) => {
  globalThis.fetch = (async (u: string) => {
    for (const [k, v] of Object.entries(routes)) if (String(u).includes(k)) return v();
    return new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;
};
const json = (b: unknown, status = 200) => () => new Response(JSON.stringify(b), { status });

test("Jupiter's index gives decimals, holders, top-10 share and the authority flags", async () => {
  mock({ "jup.ag": json([jup({})]) });
  const f = await tokenFacts(M);
  assert.deepEqual([f?.decimals, f?.holders, f?.top10Pct, f?.mintDisabled, f?.freezeDisabled, f?.launchpad], [5, 1000, 31.5, true, true, "pump.fun"]);
});
test("a result for a different mint is ignored, and GeckoTerminal is the second opinion", async () => {
  mock({
    "jup.ag": json([jup({ id: "SomethingElse1111111111111111111111111111111" })]),
    "geckoterminal": json({ data: { attributes: { decimals: 6, mint_authority: "no", freeze_authority: "yes", holders: { count: 7, distribution_percentage: { top_10: "50.5" } } } } }),
  });
  const f = await tokenFacts(M);
  assert.deepEqual([f?.decimals, f?.holders, f?.top10Pct, f?.mintDisabled, f?.freezeDisabled], [6, 7, 50.5, true, false]);
});
test("neither source knowing the coin is null, never a guess", async () => {
  mock({ "jup.ag": json([]), "geckoterminal": json({}, 404) });
  assert.equal(await tokenFacts(M), null);
});
test("with no RPC node configured, mint info comes from the index; a live authority is 'present', not invented as an address", async () => {
  mock({ "jup.ag": json([jup({ audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: true } })]) });
  const info = await getMintInfo({}, M);
  assert.equal(info?.mintAuthority, UNKNOWN_AUTHORITY);
  assert.equal(info?.freezeAuthority, null);
  assert.equal(info?.supply, (88_000_000_000_000n * 10n ** 5n).toString());
  const s = summarizeSafety(M, info);
  assert.equal(s!.checks.find((c) => c.key === "mint")!.level, "warn");
  assert.equal(s!.checks.find((c) => c.key === "freeze")!.level, "good");
});
test("if the index doesn't say whether an authority exists, safety stays unknown (never good)", async () => {
  mock({ "jup.ag": json([jup({ audit: {} })]), "geckoterminal": json({}, 404) });
  assert.equal(await getMintInfo({}, M), null);
  const s = summarizeSafety(M, null);
  assert.equal(s!.checks[0].level, "unknown");
});
