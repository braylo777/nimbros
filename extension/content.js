// NimBros — Trade from X: content script.
// Read-only DOM scanning of tweet text already on screen. Never reads DMs, never reads anything
// outside a tweet's own visible text, never sends tweet content anywhere — matching happens
// entirely against a ticker list already cached locally by background.js. The only thing this
// script ever does to the page is add a button; the only thing that button ever does is open
// NimBros in a new tab with the coin pre-filled. It never touches X's own trade/payment surfaces.

const CASHTAG = /\$([A-Za-z][A-Za-z0-9]{1,9})\b/g;
const PROCESSED = new WeakSet();
let coins = { byTicker: {}, site: "https://x-nimbros-si.pages.dev" };

function refreshCoins() {
  chrome.runtime.sendMessage({ type: "nb-get-coins" }, (res) => {
    if (chrome.runtime.lastError || !res) return; // extension context gone (e.g. reloaded) — just skip this round
    coins = res;
  });
}
refreshCoins();
setInterval(refreshCoins, 60_000);

function tickersIn(text) {
  const out = new Set();
  let m;
  CASHTAG.lastIndex = 0;
  while ((m = CASHTAG.exec(text))) out.add(m[1].toUpperCase());
  return out;
}

function makeButton(entry) {
  const a = document.createElement("a");
  a.className = "nb-trade-btn";
  a.href = `${coins.site}/?trade=${encodeURIComponent(entry.contract)}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = `Open ${entry.name} on NimBros`;
  a.textContent = "Trade on NimBros";
  // never let this act as part of the tweet: no navigating the tweet, no retweet/like side effects
  a.addEventListener("click", (e) => e.stopPropagation());
  return a;
}

function processTweet(article) {
  if (PROCESSED.has(article)) return;
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl) return;
  PROCESSED.add(article);

  const hits = [];
  for (const ticker of tickersIn(textEl.textContent || "")) {
    const entry = coins.byTicker[ticker];
    if (entry) hits.push(entry);
  }
  if (hits.length === 0) return;

  const bar = document.createElement("div");
  bar.className = "nb-trade-bar";
  for (const entry of hits.slice(0, 3)) bar.appendChild(makeButton(entry)); // a tweet mentioning several coins gets several buttons, capped
  textEl.insertAdjacentElement("afterend", bar);
}

function scan(root) {
  const nodes = root.matches?.('article[data-testid="tweet"]') ? [root] : root.querySelectorAll?.('article[data-testid="tweet"]') ?? [];
  for (const n of nodes) processTweet(n);
}

scan(document.body);

// X's timeline is virtualized and infinite-scroll; new tweets are inserted continuously.
// Batch mutations onto one scan per animation frame rather than reacting to every single node;
// added nodes accumulate here so a burst of mutations between frames is never dropped.
let pendingNodes = [];
let frameQueued = false;
const observer = new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) pendingNodes.push(n);
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    const nodes = pendingNodes;
    pendingNodes = [];
    for (const n of nodes) scan(n);
  });
});
observer.observe(document.body, { childList: true, subtree: true });
