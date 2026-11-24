# NimBros — Trade from X

A Chrome extension (Manifest V3) that watches your X timeline for coins NimBros tracks and adds a
**Trade on NimBros** button under the tweet. Clicking it opens NimBros with that coin already
loaded, wallet-ready — review and sign the swap there, same as trading from the site directly.

## What this is not

There is no public API where X or Grok execute a trade on a third-party site, and NimBros never
holds keys or funds. This extension doesn't try to fake either of those. It does the one honest
version of "trade from the feed": get you from the tweet to the right coin on NimBros in one click,
and let the existing non-custodial swap flow (build → simulate → you sign) take it from there.

## How it works

- `background.js` polls NimBros' public `GET /api/coins` endpoint every 2 minutes (via `chrome.alarms`,
  so it survives the service worker being killed) and caches a `TICKER -> contract` map.
- `content.js` runs only on `x.com`/`twitter.com`, reads the visible text of tweets already on
  screen (`[data-testid="tweetText"]`), and looks for `$TICKER` cashtags against that cached map.
  A match gets a button; nothing else about the page changes.
- The button links to `https://x-nimbros-si.pages.dev/?trade=<contract>`, which the site resolves
  via `components/DeepLink.tsx`: it waits for the live feed to carry that coin, then opens straight
  to its trade page.

No tweet content, X account data, or anything else is ever sent anywhere. The only network call
this extension makes is the read-only fetch of NimBros' own coin list.

## Permissions, and why each one is needed

| Permission | Why |
|---|---|
| `storage` | Cache the ticker map locally so the content script doesn't refetch per tweet. |
| `alarms` | Refresh that cache on a schedule; MV3 kills idle service workers, so `setInterval` alone isn't reliable. |
| `host_permissions: x-nimbros-si.pages.dev` | The one fetch this extension makes: NimBros' own public coin list. |
| `content_scripts` on x.com/twitter.com | Read tweet text already visible on screen, to match against the coin list. |

Nothing here can read X messages, X's own trade UI, or anything off the visible timeline.

## Load it (development / unpacked)

1. `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → select this `extension/` folder.
3. Open x.com — a tweet mentioning a tracked ticker (e.g. `$SUI`) should show the button within
   a couple of minutes of install (background.js's first fetch).

## Publishing

Zip this folder's contents (not the folder itself) for the Chrome Web Store developer dashboard.
The manifest's `host_permissions` is scoped to exactly one origin, which keeps review friction low.
