"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, SolMark } from "./Chrome";
import dynamic from "next/dynamic";
import { RANGE_SPEC, type Candle, type PoolTrade, type RangeId } from "@/lib/pool";
import { loadPoolData, readChartCache, writeChartCache } from "@/lib/poolClient";
import { fmtNum, fmtPct, fmtPrice, fmtUsd } from "@/lib/store";
import type { Token } from "@/lib/types";
import { DexLogo, DexTag } from "./DexLogo";
import { dexName, dexUrl } from "@/lib/dex";

/* A screenshot of a web page for the hover previews (the exchange link, the chain link). Served by our own /api/shot, which tries a real
   render (Microlink) then falls back to WordPress's mshots; kept at the edge for a week once rendered. */
const shot = (url: string) => `/api/shot?u=${encodeURIComponent(url)}`;
const SOLANA_HOME = "https://solana.com";
import { creatorFor, creatorLabel, ensureCreators, useCreators } from "@/lib/creators";
import { useLaunchAgents } from "@/lib/launches";
import { isPegged, loadPegs, pegTicker, usePegs } from "@/lib/pegged";
import { SwapPanel } from "./SwapPanel";
import { buyPressurePct } from "@/lib/backtest";
import { entryScore } from "@/lib/score";
import { track } from "@/lib/analytics";
import { useFeed } from "@/lib/feedStore";
import { useWalletStore } from "@/lib/walletStore";
import { HoldersCard, useHolders } from "./HoldersCard";
import { RiskChips, useSellCheck, useSnipers } from "./HolderRisk";
import { SafetySummary } from "./SafetySummary";
import { useFills } from "@/lib/fills";
import { findOriginals, findVamps } from "@/lib/vamp";
import { highOf, rsi } from "@/lib/indicators";
import { formatUnits } from "@/lib/units";
import { RATING_LABEL, scale5, type Factor, type Group } from "@/lib/score";
import { useNarrow } from "@/lib/useNarrow";
import { useReportView } from "@/lib/viewers";
import { EditProfile, ProfileChips, useProfile } from "./CoinProfile";
import { Tip } from "./Tip";

/* The chart library is ~50 KB and only this page needs it. */
const NativeChart = dynamic(() => import("./NativeChart").then((m) => m.NativeChart), { ssr: false });

/* Detail page for a token from the live feeds. Everything here is real:
   header and stats from the feed, chart and tape from the pool's own history.
   Orders are not simulated here — every swap is a real one, routed by Jupiter. */

/* The chart offers four views. 1m, 1h and 1d come from the pool's own history; 1s has no upstream history, so those
   bars are built here from the pool's live price, once a second, from the moment you open the coin. */
type View = "1s" | "1m" | "1H" | "1D";
const VIEWS: { id: View; label: string }[] = [{ id: "1s", label: "1s" }, { id: "1m", label: "1m" }, { id: "1H", label: "1h" }, { id: "1D", label: "1d" }];
const SEC_SPEC = { secs: 1 };
type Load = { status: "loading" } | { status: "error" } | { status: "ok"; candles: Candle[]; trades: PoolTrade[]; savedAt?: number };

const fmtSize = (n: number) => (n >= 1000 ? fmtNum(n) : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 4 }));
const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export function LiveTokenBody({ tok }: { tok: Token }) {
  usePegs();
  const wallet = useWalletStore();
  const feed = useFeed();
  const holders = useHolders(tok.contract);
  const sell = useSellCheck(tok.contract);
  const snipers = useSnipers(tok.id.replace(/^gt:/, ""), tok.contract);
  const [profile, reloadProfile] = useProfile(tok.contract);
  const narrow = useNarrow();
  useReportView(tok.contract);
  useEffect(() => { void loadPegs(); }, []);
  const [view, setView] = useState<View>("1m");
  const pool = tok.id.replace(/^gt:/, "");
  const range: RangeId = view === "1s" ? "1m" : view; // 1s still loads the 1m tape for recent trades
  const [secBars, setSecBars] = useState<{ pool: string; bars: Candle[] }>({ pool: "", bars: [] });
  const priceRef = useRef(tok.price);
  useEffect(() => { priceRef.current = tok.price; }, [tok.price]);
  useEffect(() => {
    if (view !== "1s") return;
    const t = setInterval(() => {
      const px = priceRef.current;
      if (!(px > 0)) return;
      const sec = Math.floor(Date.now() / 1000);
      setSecBars((cur) => {
        const bars = cur.pool === pool ? cur.bars.slice() : [];
        const last = bars[bars.length - 1];
        if (last && last.t === sec) bars[bars.length - 1] = { ...last, h: Math.max(last.h, px), l: Math.min(last.l, px), c: px };
        else bars.push({ t: sec, o: last ? last.c : px, h: Math.max(last ? last.c : px, px), l: Math.min(last ? last.c : px, px), c: px, v: 0 });
        return { pool, bars: bars.slice(-300) };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [view, pool]);
  const [load, setLoad] = useState<{ key: string; data: Load } | null>(null);
  const [retryTick, setRetryTick] = useState(0); // "Retry now" bumps this to reload immediately
  const creators = useCreators();
  const launchAgents = useLaunchAgents();
  useEffect(() => { void ensureCreators([tok.contract]); }, [tok.contract]);
  const key = `${pool}|${range}`;

  useEffect(() => {
    track("coin_opened");
    // Every coin opens the same way: 1-minute candles (fast — pre-aggregated history, not a live tick built second by second)
    // and market cap once it's available. Without this, switching coins keeps whatever timeframe you last tapped, since this
    // view doesn't remount between coins.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the coin itself changing, before its own data load below
    setView("1m");
  }, [tok.id]);

  useEffect(() => {
    let alive = true;
    let fails = 0;
    let quick: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      let data: Load;
      try {
        const d = await loadPoolData(pool, range);
        data = { status: "ok", candles: d.candles, trades: d.trades };
        writeChartCache(pool, range, d.candles, d.trades);
        fails = 0;
      } catch {
        data = { status: "error" };
        // look again soon instead of waiting a full interval: 6s, then 12s, then 24s, then back to normal
        if (alive && fails < 3) quick = setTimeout(run, 6000 * 2 ** fails++);
      }
      if (!alive) return;
      if (data.status === "ok") {
        setLoad({ key, data });
      } else {
        // a failed refresh must not blank a chart we already have for this coin and interval
        setLoad((prev) => (prev && prev.key === key && prev.data.status === "ok" ? prev : { key, data }));
      }
    };
    run();
    // short intervals refresh fastest; the server caches each response for 15 s, so this stays inside upstream limits
    const t = setInterval(run, range === "1m" ? 15_000 : 30_000);
    return () => {
      alive = false;
      clearInterval(t);
      if (quick) clearTimeout(quick);
    };
  }, [pool, range, key, retryTick]);

  // only ever show data that belongs to THIS coin and interval. If the live load isn't in yet (or is failing), fall back to the saved chart.
  const live: Load = load && load.key === key ? load.data : { status: "loading" };
  const [saved, setSaved] = useState<{ key: string; d: { candles: Candle[]; trades: PoolTrade[]; savedAt: number } | null }>({ key: "", d: null });
  if (saved.key !== key) setSaved({ key, d: typeof localStorage === "undefined" ? null : readChartCache(pool, range) });
  const cur: Load = live.status !== "ok" && saved.key === key && saved.d ? { status: "ok", candles: saved.d.candles, trades: saved.d.trades, savedAt: saved.d.savedAt } : live;
  const secOk = view === "1s" && secBars.pool === pool ? secBars.bars : [];
  const candles = view === "1s" ? secOk : cur.status === "ok" ? cur.candles : [];
  const trades = cur.status === "ok" ? cur.trades : [];
  const [dataTab, setDataTab] = useState<"holders" | "intel">("intel");
  const capOk = tok.marketCap > 0 && candles.length > 0;
  const capMode = capOk; // charts are always market cap; price only when there is no cap to scale by
  // Market cap = price x supply. Supply is implied by today's market cap and the latest price,
  // so the shape matches the price chart and the newest bar equals the market cap shown above.
  const capScale = capMode ? tok.marketCap / candles[candles.length - 1].c : 1;
  const shown = capMode ? candles.map((c) => ({ ...c, o: c.o * capScale, h: c.h * capScale, l: c.l * capScale, c: c.c * capScale })) : candles;
  /* the viewer's own trades of this coin, converted to the chart's units (market cap when the chart is in market cap) */
  const myFills = useFills().filter((f) => f.coin === tok.contract);
  const unit = capMode ? capScale : 1;
  const tradeMarks = myFills.flatMap((f) => {
    const tokens = Number(f.tokensRaw) / 10 ** f.decimals;
    return tokens > 0 && f.usd > 0 ? [{ t: Math.floor(f.ts / 1000), side: f.side, price: (f.usd / tokens) * unit }] : [];
  });
  const buys = tradeMarks.filter((m) => m.side === "buy");
  const entryPrice = buys.length ? buys.reduce((s2, m) => s2 + m.price, 0) / buys.length : undefined;
  const pressure = buyPressurePct(tok.buys24h, tok.sells24h);
  const creator = creatorFor(creators, tok.contract);
  const feedSocial = (re: RegExp) => (tok.socials ?? []).find((x) => re.test(x.type))?.url;
  const xUrl = profile.x ?? feedSocial(/^(twitter|x)$/i);
  const webUrl = profile.website ?? feedSocial(/^(website|web|site)$/i);
  const allTokens = [...feed.snipes, ...feed.scalps];
  const hd = holders.status === "ok" ? holders.data : null;
  const supplyText = hd && hd.supply && hd.decimals !== null ? fmtNum(Number(formatUnits(BigInt(hd.supply), hd.decimals, 0))) : "—";
  const high = highOf(candles);
  const rsiV = rsi(candles);
  const bundledPct = hd ? hd.linkedGroups.reduce((s, g) => s + g.pct, 0) : 0;
  const creatorRow = hd && creator ? hd.rows.find((r) => r.address === creator.address) : undefined;
  const score = entryScore({
    price: tok.price, liquidity: tok.liquidity, vol24h: tok.vol24h, buys24h: tok.buys24h, sells24h: tok.sells24h,
    hasSocial: tok.hasSocial || !!(profile.x || profile.website || profile.telegram),
    depth: { liquidityUsd: tok.liquidity, reserveBase: tok.reserveBase, reserveQuoteUsd: tok.reserveQuoteUsd },
    candles: candles.length ? candles : undefined,
    trades: trades.length ? trades : undefined,
    ageMin: tok.ageMin,
    changePct: tok.changePct,
    holders: hd ? { top10Pct: hd.top10Pct, creatorPct: creator ? (creatorRow?.pct ?? 0) : undefined } : undefined,
    copycats: { newer: findVamps(tok, allTokens).length, isCopy: findOriginals(tok, allTokens).length > 0 },
    sell: sell.status === "ok" && sell.verdict !== "unchecked" ? sell.verdict : null,
  });

  return (
    <>
      <section className="th-hero">
        <div className="th-top">
          <div className="th-id">
            <div className="th-avatar">
              <Avatar id={tok.id} src={tok.logo} ticker={tok.ticker} size={narrow ? 40 : 68} badge={isPegged(tok)} />
              {tok.dex && <span className="th-dexbadge"><DexLogo id={tok.dex} size={24} /></span>}
            </div>
            <div className="th-idtext">
              <h1 className="th-name">{tok.name}</h1>
              <div className="th-tags">
                <span className="th-tag mono">${pegTicker(tok)}</span>
                <SocialIcon url={xUrl} label="X">{<XIcon />}</SocialIcon>
                <SocialIcon url={webUrl} label="Website">{<GlobeIcon />}</SocialIcon>
                <Tip title="Age" noTitle foot={tok.ageMin !== undefined ? `Launched about ${ageText(tok.ageMin)} ago.` : "Launch time unknown."}><span className="th-tag th-age">{tok.ageMin !== undefined ? `${ageText(tok.ageMin)} ago` : "new"}</span></Tip>
                {creator && (
                  <Tip title="Creator" rows={[["Wallet", shortAddrLocal(creator.address), `https://solscan.io/account/${creator.address}`]]} foot={creatorLabel(creator, launchAgents)}>
                    <a className="th-tag th-icon link" href={`https://solscan.io/account/${creator.address}`} target="_blank" rel="noopener noreferrer" aria-label="Creator on Solscan"><PersonIcon /></a>
                  </Tip>
                )}
                <Tip title="Liquidity pool" rows={[["Pool", shortAddrLocal(pool), `https://solscan.io/account/${pool}`]]} foot="The on-chain account holding this coin's liquidity.">
                  <a className="th-tag th-icon link" href={`https://solscan.io/account/${pool}`} target="_blank" rel="noopener noreferrer" aria-label="Pool on Solscan"><PieIcon /></a>
                </Tip>
                <Tip title="Contract" rows={[["Mint", shortAddrLocal(tok.contract), `https://solscan.io/token/${encodeURIComponent(tok.contract)}`]]} foot="The coin's own address on Solana. Always double-check this before trusting a coin.">
                  <a className="th-tag th-icon link" href={`https://solscan.io/token/${encodeURIComponent(tok.contract)}`} target="_blank" rel="noopener noreferrer" aria-label="Contract on Solscan"><DocIcon /></a>
                </Tip>
                {tok.dex && (dexUrl(tok.dex) ? (
                  <Tip title={dexName(tok.dex)} image={shot(dexUrl(tok.dex)!)} bare scroll liveCheck={dexUrl(tok.dex)!}>
                    <a className="th-tag link" href={dexUrl(tok.dex)!} target="_blank" rel="noopener noreferrer nofollow"><DexTag id={tok.dex} size={14} /></a>
                  </Tip>
                ) : (
                  <span className="th-tag"><DexTag id={tok.dex} size={14} /></span>
                ))}
                <Tip title="Solana" image={shot(SOLANA_HOME)} bare scroll liveCheck={SOLANA_HOME}>
                  <a className="th-tag th-chain link" href={SOLANA_HOME} target="_blank" rel="noopener noreferrer">
                    <SolMark size={12} /> Solana
                  </a>
                </Tip>
                <Tip title="24h change" noTitle foot="How much the price has moved in the last 24 hours."><span className={`chgpill ${tok.changePct >= 0 ? "pos" : "neg"}`}>{tok.changePct >= 0 ? "▲" : "▼"} {fmtPct(tok.changePct)} 24h</span></Tip>
                <ProfileChips profile={profile} />
                {(tok.socials ?? []).filter((x) => x.url !== xUrl && x.url !== webUrl && x.url !== profile.telegram).slice(0, 5).map((x) => (
                  <Tip key={x.url} title={x.type} rows={[[x.type, x.url.length > 34 ? x.url.slice(0, 34) + "…" : x.url, x.url]]}>
                    <a className="th-tag link" href={x.url} target="_blank" rel="noopener noreferrer nofollow">{x.type}</a>
                  </Tip>
                ))}
                {creator && wallet.address && creator.address === wallet.address && (
                  <EditProfile coinType={tok.contract} address={wallet.address} initial={profile} signMessage={wallet.signMessage} onSaved={reloadProfile} />
                )}
              </div>
            </div>
          </div>

        </div>

      </section>

      <div className="tradelayout">
        <div className="th-main">
          <section className="th-card th-chart">
            <div className="th-cardhead">
              <div className="th-cardtitle">
                {capMode ? "Market Cap" : "Price"}
                {cur.status === "ok" && cur.savedAt && <span className="th-saved">SAVED</span>}
              </div>
              <div className="th-controls">
                {(
                  <div className="ranges">
                    {VIEWS.map((v) => (
                      <button key={v.id} className={`rangebtn${view === v.id ? " on" : ""}`} onClick={() => setView(v.id)}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="th-chartbox">
              {candles.length >= 2 ? (
                <NativeChart candles={shown} barSecs={view === "1s" ? SEC_SPEC.secs : RANGE_SPEC[range].secs} resetKey={`${key}|${view}|${capMode}`} cap={capMode} rsi livePrice={capMode ? tok.marketCap : tok.price} marks={tradeMarks} entry={entryPrice} />
              ) : (
                <div className="th-chartempty">
                  <div className="th-skeleton" aria-hidden="true">
                    <svg viewBox="0 0 400 120" preserveAspectRatio="none"><path d="M0 90 L40 78 L80 84 L120 60 L160 66 L200 40 L240 52 L280 30 L320 38 L360 18 L400 26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </div>
                  <p>{view === "1s" ? "Building 1-second bars from the live price. Give it a few seconds." : cur.status === "loading" ? "Loading…" : cur.status === "error" ? "Chart unavailable. Retrying…" : "Not enough history yet."}</p>
                  {cur.status !== "loading" && <button className="btn ghost sm" onClick={() => { setLoad(null); setRetryTick((n) => n + 1); }}>Retry now</button>}
                </div>
              )}
            </div>
          </section>

          <section className="th-card th-tabbed">
            <div className="th-tabs" role="tablist">
              {([["intel", "Intel"], ["holders", "Holders"]] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={dataTab === id} className={`th-tab${dataTab === id ? " on" : ""}`} onClick={() => setDataTab(id)}>{label}</button>
              ))}
            </div>
            <div className="th-tabbody">
              {dataTab === "holders" && (
                <>
                  <HoldersCard bare state={holders} creator={creator?.address} me={wallet.address} />
                  <RiskChips only={["Early buyers", "Sell test", "Copycat coins", "This may be a copy"]} tok={tok} holders={holders} creator={creator?.address} all={allTokens} sell={sell} snipers={snipers} />
                </>
              )}
              {dataTab === "intel" && (
                <div className="ix">
                  <SafetySummary tok={tok} sell={sell} />
                  <div className="ix-top">
                    {score.rating === null ? (
                      <p className="hint" style={{ margin: 0 }}>Gathering data ({Math.round(score.coverage * 100)}% so far). A signal needs at least half.</p>
                    ) : (
                      <div className={`th-rating ${score.grade}`}>
                        <b className="mono">{score.rating}</b>
                        <div className="th-ratingtext">
                          <span>{RATING_LABEL[score.rating]}</span>
                          <div className="th-ratingbar" aria-label={`Signal ${score.rating} of 5`}>
                            {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= score.rating! ? "on" : ""} />)}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="ix-stats">
                      <Stat k="Market Cap" v={tok.marketCap ? fmtUsd(tok.marketCap) : "—"} />
                      <Stat k="Liquidity" v={fmtUsd(tok.liquidity)} />
                      <Stat k="24h Volume" v={fmtUsd(tok.vol24h)} />
                      <Stat k="24h Trades" v={fmtNum(tok.txns)} />
                      <Stat k="Supply" v={supplyText} />
                      <Stat k={`High ${view === "1s" ? "1m" : range}`} v={high ? fmtPrice(high) : "—"} />
                      <Stat k="RSI 14" v={rsiV === null ? "—" : rsiV.toFixed(0)} />
                      <Stat k="Bundled" v={hd ? `${bundledPct.toFixed(1)}%` : "—"} />
                    </div>
                  </div>
                  {score.veto && <p className="hint th-linkwarn" style={{ margin: 0 }}>{score.veto}</p>}
                  {pressure !== null && (
                    <div className="ix-press" title="Share of 24h trades that were buys">
                      <span className="pos mono">{pressure.toFixed(0)}% buys</span>
                      <div className="th-bar"><span style={{ width: `${pressure}%` }} /></div>
                      <span className="neg mono">{(100 - pressure).toFixed(0)}% sells</span>
                    </div>
                  )}
                  <div className="ix-groups">
                    {(["Pool", "Price action", "Order flow", "Holders & safety"] as Group[]).map((g) => (
                      <div key={g} className="ix-card">
                        <div className="th-scoregroup">{g}</div>
                        {score.factors.filter((f: Factor) => f.group === g).map((f: Factor) => (
                          <div className="th-factor" key={f.key} title={`${f.note}${f.reading ? ` (${f.reading})` : ""}`}>
                            <span className="k">{f.label}</span>
                            {f.score === null ? <span className="th-f5 none">n/a</span> : <span className={`th-f5 s${scale5(f.score)}`}>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= scale5(f.score!) ? "on" : ""} />)}</span>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="rightcol">
          <SwapPanel tok={tok} />
          <section className="panel th-tradesbox">
            <div className="paneltitle">Trades</div>
            {trades.length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>{cur.status === "loading" ? "Loading trades…" : "Trades aren't available right now."}</p>
            ) : (
              <>
                <div className="tr-row head"><span>Price</span><span>Size</span><span>Value</span><span>Age</span></div>
                {trades.slice(0, 10).map((t, i) => (
                  <div className={`tr-row ${t.side}`} key={`${t.tx}${i}`}>
                    <span className={t.side === "buy" ? "pos" : "neg"}>{fmtPrice(t.price)}</span>
                    <span>{fmtSize(t.size)}</span>
                    <span>{fmtUsd(t.usd)}</span>
                    <span className="age">{ago(t.t)}</span>
                  </div>
                ))}
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

const ageText = (m: number) => (m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`);

const Ico = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">{children}</svg>
);
const PersonIcon = () => <Ico><circle cx="8" cy="5" r="3" /><path d="M2 14c0-3 2.6-5 6-5s6 2 6 5z" /></Ico>;
const PieIcon = () => <Ico><path d="M7 2a6 6 0 1 0 6 6H7z" /><path d="M9 1v6h6a6 6 0 0 0-6-6z" /></Ico>;
const DocIcon = () => <Ico><path d="M3 1h6l4 4v10H3z" /><path d="M9 1v4h4" fill="none" stroke="var(--surface-1, #fff)" strokeWidth="1" /><path d="M5 8h6M5 10h6M5 12h4" stroke="var(--surface-1, #fff)" strokeWidth="1" /></Ico>;

const XIcon = () => <Ico><path d="M12.2 1.5h2.3L9.5 7.2l5.9 7.8h-4.6L7.2 10.3 3.1 15H.8l5.4-6.2L.5 1.5h4.7l3.3 4.3zm-.8 12.2h1.3L4.6 2.8H3.2z" /></Ico>;
const GlobeIcon = () => <Ico><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5c.6.7 1.1 1.8 1.3 3H6.7c.2-1.2.7-2.3 1.3-3zM5.3 3.1A9 9 0 0 0 4.7 5.5H2.7a5.6 5.6 0 0 1 2.6-2.4zM2.3 7h2.2a12 12 0 0 0 0 2H2.3a5.5 5.5 0 0 1 0-2zm.4 3.5h2a9 9 0 0 0 .6 2.4 5.6 5.6 0 0 1-2.6-2.4zM8 13.5c-.6-.7-1.1-1.8-1.3-3h2.6c-.2 1.2-.7 2.3-1.3 3zM6.5 9a10 10 0 0 1 0-2h3a10 10 0 0 1 0 2zm4.2 3.9c.3-.7.5-1.5.6-2.4h2a5.6 5.6 0 0 1-2.6 2.4zM11.5 9a12 12 0 0 0 0-2h2.2a5.5 5.5 0 0 1 0 2zm-.2-3.5a9 9 0 0 0-.6-2.4 5.6 5.6 0 0 1 2.6 2.4z" /></Ico>;

/** A social icon: a link when the coin has one, a dimmed placeholder when it doesn't. */
function SocialIcon({ url, label, children }: { url?: string; label: string; children: React.ReactNode }) {
  return url ? (
    <Tip title={label} rows={[[label, url.length > 34 ? url.slice(0, 34) + "…" : url, url]]}>
      <a className="th-tag th-icon link" href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={label}>{children}</a>
    </Tip>
  ) : (
    <Tip title={label} noTitle foot={`No ${label} link yet.`}>
      <span className="th-tag th-icon th-off" aria-label={`No ${label} link`}>{children}</span>
    </Tip>
  );
}
const shortAddrLocal = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="ix-stat">
      <span>{k}</span>
      <b className="mono">{v}</b>
    </div>
  );
}

