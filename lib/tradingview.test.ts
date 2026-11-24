import test from "node:test";
import assert from "node:assert/strict";
import { normType, tvEmbedUrl, tvSymbolFor } from "./tradingview.ts";

const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

test("established coins are found by their mint address", () => {
  assert.equal(tvSymbolFor(SOL)?.symbol, "BINANCE:SOLUSDT");
  assert.equal(tvSymbolFor(BONK)?.symbol, "BINANCE:BONKUSDT");
  assert.equal(normType("  " + SOL + " "), SOL);
});
test("a memecoin that copies a ticker is NOT mapped — matching is by mint, never symbol; base58 is case-sensitive", () => {
  assert.equal(tvSymbolFor("FakeSo1111111111111111111111111111111111111"), null);
  assert.equal(tvSymbolFor("DK4ZbFhi9HnC2aWnmiPMZfbLMCWS8EAoFwnf79oSpump"), null);
  assert.equal(tvSymbolFor(""), null);
  assert.equal(tvSymbolFor(SOL.toLowerCase()), null);
  // a lookalike with one character changed must not match
  assert.equal(tvSymbolFor(BONK.slice(0, -1) + "4"), null);
});
test("embed url is TradingView's widget origin with fixed parameters", () => {
  const u = new URL(tvEmbedUrl("BINANCE:SOLUSDT", "1H"));
  assert.equal(u.origin, "https://s.tradingview.com");
  assert.equal(u.pathname, "/widgetembed/");
  assert.equal(u.searchParams.get("symbol"), "BINANCE:SOLUSDT");
  assert.equal(u.searchParams.get("interval"), "60");
  assert.equal(new URL(tvEmbedUrl("X:Y", "nonsense")).searchParams.get("interval"), "15");
});
