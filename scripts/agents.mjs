#!/usr/bin/env node
/* Approve or revoke wallets for real agent trading, live, with no redeploy.
     node scripts/agents.mjs list
     node scripts/agents.mjs approve <0x wallet> [perTradeUsd=25] [dailyUsd=75] [note]
     node scripts/agents.mjs revoke  <0x wallet>
   Writes to the production D1 database through wrangler. Caps are dollars, 1 to 1000. */
import { execFileSync } from "node:child_process";

const [cmd, addr, per = "25", day = "75", ...note] = process.argv.slice(2);
const run = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "nimbros-agents", "--remote", "--json", "--command", sql], { encoding: "utf8" });
const fail = (m) => { console.error(m); process.exit(1); };
const okAddr = (a) => /^0x[0-9a-f]{64}$/.test(a ?? "");
const okCap = (n) => /^\d+(\.\d+)?$/.test(n) && Number(n) >= 1 && Number(n) <= 1000;

if (cmd === "list") {
  const out = JSON.parse(run("SELECT address, per_trade_usd, daily_usd, note, ts FROM approved_wallets ORDER BY ts DESC"));
  const rows = out[0]?.results ?? [];
  if (!rows.length) console.log("No wallets approved.");
  for (const r of rows) console.log(`${r.address}  $${r.per_trade_usd}/trade  $${r.daily_usd}/day  ${r.note}`);
} else if (cmd === "approve") {
  if (!okAddr(addr)) fail("wallet must be a full lowercase 0x address (66 characters)");
  if (!okCap(per) || !okCap(day) || Number(day) < Number(per)) fail("caps must be 1 to 1000 dollars and daily >= per trade");
  const n = note.join(" ").replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 60);
  run(`INSERT INTO approved_wallets (address, per_trade_usd, daily_usd, note, ts) VALUES ('${addr}', ${Number(per)}, ${Number(day)}, '${n}', ${Date.now()}) ON CONFLICT(address) DO UPDATE SET per_trade_usd = ${Number(per)}, daily_usd = ${Number(day)}, note = '${n}'`);
  console.log(`Approved ${addr}: $${per} per trade, $${day} per day.`);
} else if (cmd === "revoke") {
  if (!okAddr(addr)) fail("wallet must be a full lowercase 0x address (66 characters)");
  run(`DELETE FROM approved_wallets WHERE address = '${addr}'`);
  console.log(`Revoked ${addr}.`);
} else {
  fail("usage: agents.mjs list | approve <wallet> [perTradeUsd] [dailyUsd] [note] | revoke <wallet>");
}
