import { sellImpact, type Depth } from "./depth.ts";

/* Market-side risk, computed from feed data only. PURE.

   These are arithmetic facts about depth and size — not predictions, not a
   verdict on the team or the contract. Anything that needs data we don't have
   (holder concentration, contract audit, whether the code blocks selling) is
   listed as not checked rather than quietly assumed to be fine. */

export interface RiskRow {
  key: "exit" | "depth" | "age" | "flow";
  label: string;
  value: string;
  level: "good" | "warn" | "bad" | "unknown";
  detail: string;
}

/** Standard exit size the whole app quotes against, so the number is comparable between coins. */
export const EXIT_TEST_USD = 500;

/** What it would cost, in price impact, to sell `usd` worth right now. */
export function exitCostPct(usd: number, price: number, d: Depth): { pct: number; estimated: boolean } | null {
  if (!(usd > 0) || !(price > 0)) return null;
  if (!(d.liquidityUsd > 0)) return null;
  const { impact, model } = sellImpact(usd / price, price, d);
  if (!Number.isFinite(impact)) return null;
  return { pct: Math.min(100, impact * 100), estimated: model === "estimate" };
}

const pct = (n: number) => `${n < 10 ? n.toFixed(1) : n.toFixed(0)}%`;

export function exitRow(price: number, d: Depth): RiskRow {
  const e = exitCostPct(EXIT_TEST_USD, price, d);
  if (!e) {
    return { key: "exit", label: `Cost to sell $${EXIT_TEST_USD}`, value: "—", level: "unknown", detail: "Not enough pool data." };
  }
  const level = e.pct < 1 ? "good" : e.pct < 5 ? "warn" : "bad";
  return {
    key: "exit",
    label: `Cost to sell $${EXIT_TEST_USD}`,
    value: `${pct(e.pct)}${e.estimated ? " est." : ""}`,
    level,
    detail:
      level === "good"
        ? "You can sell this much without moving the price."
        : level === "warn"
          ? "Selling this much moves the price."
          : "Even a small sale costs a lot. The pool is thin.",
  };
}

/** Liquidity as a share of market cap: how much of the "value" is actually tradable. */
export function depthRow(liquidityUsd: number, marketCapUsd: number): RiskRow {
  if (!(liquidityUsd > 0) || !(marketCapUsd > 0)) {
    return { key: "depth", label: "Liquidity vs market cap", value: "—", level: "unknown", detail: "No market cap reported." };
  }
  const r = (liquidityUsd / marketCapUsd) * 100;
  // more liquidity than market cap means one of the two is mis-reported upstream:
  // say so instead of presenting it as an unusually healthy pool
  if (r > 100) {
    return {
      key: "depth",
      label: "Liquidity vs market cap",
      value: ">100%",
      level: "unknown",
      detail: "Market cap is smaller than the pool, so one figure is wrong.",
    };
  }
  const level = r >= 10 ? "good" : r >= 2 ? "warn" : "bad";
  return {
    key: "depth",
    label: "Liquidity vs market cap",
    value: pct(r),
    level,
    detail:
      level === "good"
        ? "Much of the market cap is tradable."
        : level === "warn"
          ? "Little of the market cap is tradable."
          : "Almost none of the market cap is tradable.",
  };
}

export function ageRow(ageMin?: number): RiskRow {
  if (ageMin === undefined) return { key: "age", label: "Pool age", value: "—", level: "unknown", detail: "No creation time reported." };
  const h = ageMin / 60;
  const value = ageMin < 60 ? `${Math.floor(ageMin)}m` : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
  const level = h < 24 ? "bad" : h < 24 * 7 ? "warn" : "good";
  return {
    key: "age",
    label: "Pool age",
    value,
    level,
    detail:
      level === "bad"
        ? "Under a day old. No history to judge by."
        : level === "warn"
          ? "Under a week old."
          : "At least a week of history.",
  };
}

export function flowRow(buys?: number, sells?: number): RiskRow {
  if (buys === undefined || sells === undefined || buys + sells === 0) {
    return { key: "flow", label: "Buy / sell balance (24h)", value: "—", level: "unknown", detail: "No trade counts reported." };
  }
  const total = buys + sells;
  const buyPct = (buys / total) * 100;
  const level = total < 50 ? "warn" : "good";
  return {
    key: "flow",
    label: "Buy / sell balance (24h)",
    value: `${buyPct.toFixed(0)}% buys of ${total}`,
    level,
    detail:
      total < 50
        ? "Few trades. One trader can move the price."
        : buyPct >= 60
          ? "More buys than sells."
          : buyPct <= 40
            ? "More sells than buys."
            : "Buys and sells are about even.",
  };
}

export interface RiskSummary {
  rows: RiskRow[];
  level: "good" | "warn" | "bad" | "unknown";
  headline: string;
}

export function marketRisk(t: {
  price: number; liquidity: number; marketCap: number; ageMin?: number;
  buys24h?: number; sells24h?: number; reserveBase?: number; reserveQuoteUsd?: number;
}): RiskSummary {
  const d: Depth = { liquidityUsd: t.liquidity, reserveBase: t.reserveBase, reserveQuoteUsd: t.reserveQuoteUsd };
  const rows = [exitRow(t.price, d), depthRow(t.liquidity, t.marketCap), ageRow(t.ageMin), flowRow(t.buys24h, t.sells24h)];
  const bad = rows.filter((r) => r.level === "bad").length;
  const warn = rows.filter((r) => r.level === "warn").length;
  const known = rows.filter((r) => r.level !== "unknown").length;
  const level = known === 0 ? "unknown" : bad > 0 ? "bad" : warn > 0 ? "warn" : "good";
  const headline =
    level === "bad"
      ? "High risk: thin pool or brand new."
      : level === "warn"
        ? "Some risk: tradable, with caveats."
        : level === "good"
          ? "No thin-market warnings."
          : "Not enough data.";
  return { rows, level, headline };
}
