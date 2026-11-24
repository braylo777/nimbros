#!/usr/bin/env node
/* Writes public/stats.json: {launchpads, coins_live, vol_24h, as_of}.
     node scripts/stats.mjs [baseUrl]        (default: https://x-nimbros-si.pages.dev)
   launchpads = distinct launchpads/DEXes among the live coins (GET /api/coins).
   coins_live = number of live coins. vol_24h = agent volume in USD over 24h (GET /api/stats).
   as_of is an ISO timestamp, so a card can show how old the numbers are. */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function compute(coinsBody, statsBody, now = new Date()) {
  const coins = Array.isArray(coinsBody?.coins) ? coinsBody.coins : Array.isArray(coinsBody) ? coinsBody : [];
  const pads = new Set(coins.map((c) => String(c?.dex ?? "").trim().toLowerCase()).filter(Boolean));
  const vol = Number(statsBody?.vol24hUsd);
  return {
    launchpads: pads.size,
    coins_live: coins.length,
    vol_24h: Number.isFinite(vol) && vol >= 0 ? Math.round(vol * 100) / 100 : 0,
    as_of: now.toISOString(),
  };
}

async function getJson(url, f = fetch) {
  const r = await f(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export async function build(base, f = fetch, now = new Date()) {
  const root = base.replace(/\/+$/, "");
  const [coins, stats] = await Promise.all([getJson(`${root}/api/coins`, f), getJson(`${root}/api/stats`, f)]);
  return compute(coins, stats, now);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL("../public/stats.json", import.meta.url));
  try {
    const s = await build(process.argv[2] ?? "https://x-nimbros-si.pages.dev");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(s, null, 2) + "\n");
    console.log(`wrote ${out}`, s);
  } catch (e) {
    console.error("stats failed:", e.message);
    process.exit(1);
  }
}
