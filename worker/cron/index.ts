/* Scheduled worker: calls the site's /api/cron/tick a few times a minute so price alerts and
   webhook delivery run without anyone having the site open.
   Cloudflare cron fires at most once a minute, so each run ticks every 15 seconds for a minute. */

interface Env { SITE: string; CRON_SECRET: string }
const STEP_MS = 15_000;
const STEPS = 4;

/** Rebuilds the token lists from every exchange (the site stores them ready to serve). */
async function refreshFeeds(env: Env): Promise<void> {
  try {
    await fetch(`${env.SITE}/api/cron/feeds`, { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET }, signal: AbortSignal.timeout(25_000) });
  } catch { /* the next run tries again */ }
}

async function tickOnce(env: Env): Promise<void> {
  try {
    await fetch(`${env.SITE}/api/cron/tick`, { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET }, signal: AbortSignal.timeout(20_000) });
  } catch { /* the next tick tries again */ }
}

/** Sentinel: scans the wallets agents asked NimBros to watch and sends any new warning to their webhook. */
async function watchWallets(env: Env): Promise<void> {
  try {
    await fetch(`${env.SITE}/api/cron/watch`, { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET }, signal: AbortSignal.timeout(25_000) });
  } catch { /* the next run tries again */ }
}

const worker = {
  async scheduled(_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil((async () => {
      for (let i = 0; i < STEPS; i++) {
        if (i === 0 || i === 2) await refreshFeeds(env); // twice a minute, 30 seconds apart
        if (i === 1) await watchWallets(env); // once a minute
        await tickOnce(env);
        if (i < STEPS - 1) await new Promise((r) => setTimeout(r, STEP_MS));
      }
    })());
  },
};
export default worker;
