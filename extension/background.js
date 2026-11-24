// NimBros — Trade from X: background service worker.
// The only network call this extension makes: a read-only fetch of NimBros' own public coin list.
// Nothing here ever touches a wallet, a key, or X's own data — it just keeps a ticker->contract
// map fresh so the content script can build a link. MV3 kills idle service workers, so refreshing
// runs on chrome.alarms (survives restarts) instead of setInterval (does not).

const SITE = "https://x-nimbros-si.pages.dev";
const STORAGE_KEY = "nb_coins";
const ALARM = "nb_refresh";
const REFRESH_MIN = 2;

async function refresh() {
  try {
    const r = await fetch(`${SITE}/api/coins`, { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (!Array.isArray(j.coins)) return;
    // keyed by uppercase ticker for O(1) lookup in the content script; last-liquidity-listed wins
    // ties silently, which is fine for a "does this exist on NimBros" check, not a precise router
    const byTicker = {};
    for (const c of j.coins) {
      if (typeof c.ticker !== "string" || typeof c.contract !== "string") continue;
      byTicker[c.ticker.toUpperCase()] = { contract: c.contract, id: c.id, name: c.name };
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: { byTicker, ts: Date.now() } });
  } catch {
    // offline or NimBros is down: keep serving whatever we already cached
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MIN });
  void refresh();
});
chrome.runtime.onStartup.addListener(() => {
  void refresh();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void refresh();
});

// The content script asks for the map rather than reading storage directly, so there's one place
// that decides "is this fresh enough" and one place that knows the site URL.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "nb-get-coins") return false;
  chrome.storage.local.get(STORAGE_KEY).then((v) => {
    sendResponse({ byTicker: v[STORAGE_KEY]?.byTicker ?? {}, site: SITE });
  });
  return true; // keep the message channel open for the async response
});
