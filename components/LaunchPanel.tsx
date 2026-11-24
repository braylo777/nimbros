"use client";

import { useState } from "react";
import { useApp } from "./AppState";
import { requestWallet } from "@/lib/walletStore";
import { WalletModal } from "./Chrome";
import { LaunchPreview } from "./LaunchPreview";
import { EMPTY_FORM, ProfileFields, formToProfile, saveProfile, type ProfileForm } from "./CoinProfile";
import { solscanToken, solscanTx } from "@/lib/chain";
import { track } from "@/lib/analytics";
import { CHAINS, CHAIN_LIST, explorerAddress, explorerToken, explorerTx, type Chain, type ChainId } from "@/lib/chains";
import { connectEvm, evmCall, preferredWallet, sendDeploy, switchEvmChain, useEvmWallet, waitForReceipt } from "@/lib/evmWallet";

/* Launch: one page for every chain. On Solana the rules are fixed in the transaction and checkable on chain: the whole supply is minted once to YOUR
   wallet, the mint authority is then revoked for good, there is no freeze authority, and the name and symbol can never change. On the EVM chains
   (BNB Chain, Ethereum, Polygon, Avalanche) the same rules are written into the token contract itself: minted once to you,
   no owner, no mint function, no fees, no pause. After it is deployed the page reads the contract back from the chain to prove it.
   NimBros never holds a key or the coin. */


type Phase =
  | { k: "idle" }
  | { k: "preparing" }
  | { k: "refused"; message: string }
  | { k: "review"; tx: import("@solana/web3.js").VersionedTransaction; mintKp: import("@solana/web3.js").Keypair }
  | { k: "review_evm"; plan: EvmPlan }
  | { k: "signing" }
  | { k: "waiting"; hash: string; chain: Chain }
  | { k: "done"; mint: string; sig: string }
  | { k: "done_evm"; chain: Chain; token: string; hash: string; verified: boolean; supply: string }
  | { k: "failed"; message: string; sig?: string };

interface EvmPlan { chain: Chain; data: string; gas: number; feeNative: number | null; estimated: boolean; symbol: string; supplyWhole: string }

/** Where to add the first liquidity for a new coin on each chain. The launcher pastes the token address there. */
const marketLink = (c: Chain, token: string): string =>
  c.id === "bsc" ? `https://pancakeswap.finance/add/BNB/${token}?chain=bsc` : `https://app.uniswap.org/explore/tokens/${c.id}/${token}`;
const SEL_TOTAL_SUPPLY = "0x18160ddd";
const SEL_BALANCE_OF = "0x70a08231";

const Lock = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.6" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></svg>
);

export function LaunchPanel() {
  const { wallet, requireWallet, toast } = useApp();
  const address = wallet.address;
  const [chain, setChain] = useState<ChainId>("solana");
  const evm = useEvmWallet();
  const cfg = CHAINS[chain];
  const isEvm = cfg.kind === "evm";
  const [f, setF] = useState({ name: "", symbol: "", supply: "1000000000" }); // supply is fixed: every launch is 1 billion coins
  const [linksOpen, setLinksOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [ack, setAck] = useState(false);
  const [pf, setPf] = useState<ProfileForm>(EMPTY_FORM);
  const [pfErr, setPfErr] = useState<string | null>(null);
  const [linksNote, setLinksNote] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const hasProfile = Object.values(pf).some((v) => (v ?? "").trim() !== "");
  const linkCount = Object.entries(pf).filter(([k, v]) => k !== "description" && k !== "icon" && String(v ?? "").trim() !== "").length;
  const set = (k: keyof typeof f, v: string) => { setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k === "supply" ? "supplyWhole" : k]: "" })); };

  /* Shrinks the picture to 256 px in the browser (so it is small and always a real image), then stores it and uses its link. */
  const uploadLogo = async (file: File) => {
    setLogoErr(null);
    setLogoBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const side = Math.min(256, Math.max(bmp.width, bmp.height));
      const scale = side / Math.max(bmp.width, bmp.height);
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * scale));
      cv.height = Math.max(1, Math.round(bmp.height * scale));
      cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/png"));
      const small = blob && blob.size <= 80 * 1024 ? blob : await new Promise<Blob | null>((res) => cv.toBlob(res, "image/jpeg", 0.85));
      if (!small) throw new Error("encode");
      const r = await fetch("/api/logo", { method: "POST", headers: { "content-type": small.type }, body: small });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? "upload");
      setPf((p) => ({ ...p, icon: j.url }));
    } catch (e) {
      setLogoErr(e instanceof Error && e.message.length > 8 && e.message !== "encode" ? e.message : "Couldn't use that image. Try a PNG or JPEG.");
    } finally {
      setLogoBusy(false);
    }
  };

  async function reviewEvm() {
    setNote(null);
    let from = evm.address;
    if (!from) {
      try { from = await connectEvm(preferredWallet()); } catch (e) { return setNote(e instanceof Error ? e.message : "Couldn't connect an EVM wallet."); }
    }
    if (f.name.trim().length < 2 || f.symbol.length < 2) return setNote("Add a name and a symbol first.");
    setErrors({});
    setPhase({ k: "preparing" });
    try {
      const r = await fetch("/api/launch/evm-build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, name: f.name, symbol: f.symbol, supplyWhole: f.supply, address: from }) });
      const j = (await r.json()) as { data?: string; gas?: number; feeNative?: number | null; estimated?: boolean; symbol?: string; supplyWhole?: string; error?: string; errors?: Record<string, string> };
      if (!r.ok || !j.data || !j.gas) {
        setPhase({ k: "idle" });
        if (j.errors) { setErrors(j.errors); return setNote("Fix the highlighted fields above."); }
        return setPhase({ k: "refused", message: j.error ?? "Couldn't prepare that launch." });
      }
      setAck(false);
      track("launch_reviewed");
      setPhase({ k: "review_evm", plan: { chain: cfg, data: j.data, gas: j.gas, feeNative: j.feeNative ?? null, estimated: !!j.estimated, symbol: j.symbol ?? f.symbol, supplyWhole: j.supplyWhole ?? f.supply } });
    } catch {
      setPhase({ k: "refused", message: "Couldn't prepare the launch (network error). Nothing was sent." });
    }
  }

  async function signEvm(plan: EvmPlan) {
    if (!evm.address) return;
    setPhase({ k: "signing" });
    try {
      if (evm.chainId !== plan.chain.evmId) await switchEvmChain(plan.chain);
      const hash = await sendDeploy(evm.address, plan.data, plan.gas);
      setPhase({ k: "waiting", hash, chain: plan.chain });
      const rc = await waitForReceipt(hash);
      if (!rc) return setPhase({ k: "failed", message: "Not confirmed yet. Check your wallet and the explorer before trying again.", sig: hash });
      if (rc.status !== "success" || !rc.contractAddress) return setPhase({ k: "failed", message: "The deployment reverted on-chain. Only the network fee was spent.", sig: hash });
      track("launch_signed");
      // read the contract back from the chain: the supply must be exactly what was chosen, and all of it in the launcher's wallet
      const want = BigInt(plan.supplyWhole) * 10n ** 18n;
      let verified = false;
      try {
        const total = BigInt(await evmCall(rc.contractAddress, SEL_TOTAL_SUPPLY));
        const bal = BigInt(await evmCall(rc.contractAddress, SEL_BALANCE_OF + evm.address.slice(2).toLowerCase().padStart(64, "0")));
        verified = total === want && bal === want;
      } catch { /* the explorer link still shows the truth */ }
      setPhase({ k: "done_evm", chain: plan.chain, token: rc.contractAddress, hash, verified, supply: plan.supplyWhole });
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      setPhase({ k: "failed", message: /reject|denied|cancel|4001/i.test(m) ? "You declined in your wallet. Nothing was launched." : `The wallet couldn't complete it${m ? `: ${m.slice(0, 140)}` : ""}. Nothing was launched.` });
    }
  }

  async function review() {
    if (isEvm) return reviewEvm();
    setNote(null);
    if (!requireWallet() || !address) { requestWallet(); setPicker(true); return setNote("Connect your wallet to launch."); }
    if (f.name.trim().length < 2 || f.symbol.length < 2) return setNote("Add a name and a symbol first.");
    setErrors({});
    if (hasProfile && !formToProfile(pf)) return setPfErr("Links must be https (X/Twitter and Telegram links must be on those sites); the description is 200 characters or fewer. Pair needs a chain name and address.");
    setPfErr(null);
    setPhase({ k: "preparing" });
    try {
      const { Keypair, VersionedTransaction } = await import("@solana/web3.js"); // loaded only when a launch is actually made
      const mintKp = Keypair.generate(); // its secret exists only in this browser tab and signs this one transaction
      const r = await fetch("/api/launch/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, symbol: f.symbol, supplyWhole: f.supply, decimals: 6, address, mint: mintKp.publicKey.toBase58() }) });
      const j = (await r.json()) as { txBytes?: string; error?: string; errors?: Record<string, string> };
      if (!r.ok || !j.txBytes) {
        setPhase({ k: "idle" });
        if (j.errors) { setErrors(j.errors); return setNote("Fix the highlighted fields above."); }
        return setPhase({ k: "refused", message: j.error ?? "Couldn't prepare that launch." });
      }
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(j.txBytes), (c) => c.charCodeAt(0)));
      setAck(false);
      track("launch_reviewed");
      setPhase({ k: "review", tx, mintKp });
    } catch {
      setPhase({ k: "refused", message: "Couldn't prepare the launch (network or wallet error). Nothing was sent." });
    }
  }

  async function sign(p: Extract<Phase, { k: "review" }>) {
    setPhase({ k: "signing" });
    try {
      p.tx.sign([p.mintKp]);
      const res = await wallet.sign({ transaction: p.tx });
      if (!res.success) return setPhase({ k: "failed", message: res.timedOut ? "Not confirmed yet. Check your wallet before trying again." : "The launch didn't go through on-chain. Only the network fee was spent.", sig: res.signature });
      track("launch_signed");
      const mint = p.mintKp.publicKey.toBase58();
      void fetch("/api/launches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coinType: mint }) }).catch(() => {});
      if (hasProfile) {
        setLinksNote("Saving your details…");
        // the chain needs a moment before it can show who created the coin
        void new Promise((r) => setTimeout(r, 6000))
          .then(() => saveProfile(mint, address!, pf, wallet.signMessage))
          .then((e) => setLinksNote(e ? `Details not saved: ${e} You can add them from the coin's page.` : "Details saved."));
      } else setLinksNote(null);
      setPhase({ k: "done", mint, sig: res.signature });
    } catch (e) {
      setPhase({ k: "failed", message: /reject|denied|cancel/i.test(String((e as Error)?.message ?? "")) ? "You declined in your wallet. Nothing was launched." : "The request failed. Nothing was launched." });
    }
  }

  const close = () => setPhase({ k: "idle" });
  const busy = phase.k === "preparing" || phase.k === "signing" || phase.k === "waiting";
  const supplyBig = BigInt(f.supply);
  const icon = pf.icon ?? "";

  return (
    <div className="lp lx">
      <div className="lx-form">
        <section className="lx-card lx-one">
          <ChainSelect value={chain} onChange={setChain} />
          {isEvm && (
            <div className="lx-evmrow">
              {evm.address ? <span>{evm.wallet ?? "Wallet"} · <b className="mono">{evm.address.slice(0, 6)}…{evm.address.slice(-4)}</b>{evm.chainId !== cfg.evmId ? ` · will switch to ${cfg.name}` : ""}</span> : <span>Launching on {cfg.name} uses an EVM wallet (Phantom, MetaMask, Rabby …).</span>}
              {!evm.address && <button type="button" className="btn ghost sm" onClick={() => connectEvm(preferredWallet()).catch((e) => setNote(e instanceof Error ? e.message : "Couldn't connect."))}>Connect EVM wallet</button>}
            </div>
          )}

          <div className="lx-id">
            <label
              className={`lx-drop${dragging ? " on" : ""}${icon ? " has" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file) void uploadLogo(file); }}
              title="Upload a logo (PNG, JPEG or WebP)"
            >
              {icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- the launcher's own logo, previewed as chosen
                <img src={icon} alt="Your logo" referrerPolicy="no-referrer" />
              ) : (
                <span className="lx-dropin">
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14" /></svg>
                  <b>{logoBusy ? "Uploading…" : "Add logo"}</b>
                </span>
              )}
              {logoBusy && <em className="lx-spin" aria-hidden="true" />}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={logoBusy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void uploadLogo(file); }} />
            </label>
            <div className="lx-fields">
              <Field label="Name" err={errors.name}>
                <input className="field lx-in" value={f.name} maxLength={32} onChange={(e) => set("name", e.target.value)} placeholder={isEvm ? "Moon Cat" : "Sol Frog"} />
              </Field>
              <Field label="Symbol" err={errors.symbol}>
                <div className="lx-sym"><b>$</b><input className="field lx-in mono" value={f.symbol} maxLength={10} onChange={(e) => set("symbol", e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="FROG" /></div>
              </Field>
            </div>
          </div>
          {logoErr && <span className="inlineerr">{logoErr}</span>}
          <Field label="Description (optional)">
            <textarea className="field lx-in lx-ta" rows={2} value={pf.description ?? ""} maxLength={200} onChange={(e) => setPf((p) => ({ ...p, description: e.target.value }))} placeholder="What is this coin about?" />
            <small className="lx-count">{(pf.description ?? "").length}/200</small>
          </Field>

          <div className="lx-fixed"><span>Total supply</span><b className="mono">1,000,000,000</b></div>

          <details className="lx-links" open={linksOpen} onToggle={(e) => setLinksOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>
              <span>Links</span>
              <em>{linkCount > 0 ? `${linkCount} added` : "optional"}</em>
              <i aria-hidden="true">▾</i>
            </summary>
            <ProfileFields className="pf-grid" f={pf} set={(k, v) => setPf((p) => ({ ...p, [k]: v }))} />
            {pfErr && <span className="inlineerr">{pfErr}</span>}
          </details>
        </section>

        <div className="lx-cta">
          <button className="btn lx-go" onClick={review} disabled={busy}>{(isEvm ? evm.address : address) ? "Review launch" : isEvm ? "Connect EVM wallet to launch" : "Connect wallet to launch"}</button>
          {note && <span className="inlineerr" role="alert">{note}</span>}
        </div>

        {phase.k !== "idle" && (
          <div className="scrim" onClick={!busy ? close : undefined}>
            <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              {phase.k === "preparing" && (
                <>
                  <div className="paneltitle" style={{ marginBottom: 0 }}>Checking the launch</div>
                  <p className="hint">{isEvm ? `Estimating the deployment on ${cfg.name}. Nothing is sent.` : "Simulating on Solana mainnet and screening the transaction. Nothing is sent."}</p>
                </>
              )}
              {phase.k === "refused" && (
                <>
                  <div className="paneltitle" style={{ marginBottom: 0 }}>Not launching</div>
                  <p className="modalmsg">{phase.message}</p>
                  <button className="btn ghost" onClick={close}>Close</button>
                </>
              )}
              {phase.k === "review" && (
                <>
                  <div className="lx-rv-head">
                    <span className="lx-rv-av">
                      {icon ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the launcher's own logo, shown back for confirmation
                        <img src={icon} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <b>{f.symbol.charAt(0) || "?"}</b>
                      )}
                    </span>
                    <div>
                      <div className="lx-rv-name">{f.name.trim()}</div>
                      <div className="lx-rv-sym mono">${f.symbol}</div>
                    </div>
                    <span className="lx-rv-tag">Review launch</span>
                  </div>
                  <div className="lx-rv-supply">
                    <span>Total supply</span>
                    <b className="mono">{supplyBig.toLocaleString("en-US")}</b>
                    <small>All sent to your wallet</small>
                  </div>
                  <div className="lx-rv-locks">
                    <span><Lock />Minting locked right after</span>
                    <span><Lock />No freeze key</span>
                    <span><Lock />Name &amp; symbol locked</span>
                  </div>
                  <Row k="Decimals" v="6" />
                  <Row k="Network fee" v="≈ 0.02 SOL (rent for the coin's accounts)" />
                  <Row k="Network" v="Solana mainnet" />
                  <label className="lx-rv-terms">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>This launch is final. Supply, minting and the name can&apos;t be changed afterwards, it has no market until liquidity is added, and I&apos;m responsible for the coin I create.</span>
                  </label>
                  <button className="btn lx-go" disabled={!ack} onClick={() => sign(phase)}>Confirm &amp; sign</button>
                  <button className="btn ghost" onClick={close}>Cancel</button>
                </>
              )}
              {phase.k === "review_evm" && (
                <>
                  <div className="lx-rv-head">
                    <span className="lx-rv-av">
                      {icon ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the launcher's own logo, shown back for confirmation
                        <img src={icon} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <b>{f.symbol.charAt(0) || "?"}</b>
                      )}
                    </span>
                    <div>
                      <div className="lx-rv-name">{f.name.trim()}</div>
                      <div className="lx-rv-sym mono">${f.symbol}</div>
                    </div>
                    <span className="lx-rv-tag">{phase.plan.chain.name}</span>
                  </div>
                  <div className="lx-rv-supply">
                    <span>Total supply</span>
                    <b className="mono">{supplyBig.toLocaleString("en-US")}</b>
                    <small>All sent to your wallet</small>
                  </div>
                  <div className="lx-rv-locks">
                    <span><Lock />Cannot mint more, ever</span>
                    <span><Lock />No owner, no pause</span>
                    <span><Lock />No fees, no blacklist</span>
                  </div>
                  <Row k="Decimals" v="18" />
                  <Row k="Network fee" v={phase.plan.feeNative !== null ? `≈ ${phase.plan.feeNative.toFixed(phase.plan.feeNative < 0.001 ? 5 : 4)} ${phase.plan.chain.native}${phase.plan.estimated ? "" : " (rough)"}` : `paid in ${phase.plan.chain.native}; your wallet shows it`} />
                  <Row k="Network" v={`${phase.plan.chain.name} mainnet`} />
                  <label className="lx-rv-terms">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>This launch is final. Supply and name can&apos;t be changed afterwards, it has no market until liquidity is added, and I&apos;m responsible for the coin I create.</span>
                  </label>
                  <button className="btn lx-go" disabled={!ack} onClick={() => signEvm(phase.plan)}>Confirm &amp; sign</button>
                  <button className="btn ghost" onClick={close}>Cancel</button>
                </>
              )}
              {phase.k === "waiting" && (
                <>
                  <div className="paneltitle" style={{ marginBottom: 0 }}>Deploying on {phase.chain.name}</div>
                  <p className="hint">Waiting for the network to confirm. This usually takes a few seconds.</p>
                  <a className="hint" href={explorerTx(phase.chain, phase.hash)} target="_blank" rel="noopener noreferrer">Watch the transaction ↗</a>
                </>
              )}
              {phase.k === "done_evm" && (
                <>
                  <div className="paneltitle" style={{ marginBottom: 0 }}>Coin launched on {phase.chain.name}</div>
                  <Row k="Token address" v={phase.token} mono />
                  <p className="hint">{phase.verified ? `Checked on chain: the supply is exactly ${BigInt(phase.supply).toLocaleString("en-US")} and all of it is in your wallet.` : "Couldn't read the contract back just now; the explorer link shows the truth."} It has no market yet: add liquidity on a DEX to create one.</p>
                  <a className="hint" href={explorerToken(phase.chain, phase.token)} target="_blank" rel="noopener noreferrer">View the coin on the explorer ↗</a>
                  <a className="hint" href={explorerTx(phase.chain, phase.hash)} target="_blank" rel="noopener noreferrer">View the transaction ↗</a>
                  <a className="btn" href={marketLink(phase.chain, phase.token)} target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: "none" }} onClick={() => toast("Paste your token address there.")}>Put it on the market →</a>
                  <button className="btn ghost" onClick={close}>Later</button>
                </>
              )}
              {phase.k === "signing" && (
                <>
                  <div className="paneltitle" style={{ marginBottom: 0 }}>Confirm in your wallet</div>
                  <p className="hint">Approve in your wallet.</p>
                </>
              )}
              {phase.k === "done" && (
                <>
                  <div className="paneltitle" style={{ marginBottom: 0 }}>Coin launched</div>
                  <Row k="Mint address" v={phase.mint} mono />
                  <p className="hint">The full supply is in your wallet. It has no market yet: add liquidity on a DEX or launchpad to create one.</p>
                  {linksNote && <p className="hint">{linksNote}</p>}
                  <a className="hint" href={solscanToken(phase.mint)} target="_blank" rel="noopener noreferrer">View the coin on Solscan ↗</a>
                  <a className="hint" href={solscanTx(phase.sig)} target="_blank" rel="noopener noreferrer">View the transaction ↗</a>
                  <a className="btn" href="https://raydium.io/liquidity/create-pool/" target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: "none" }} onClick={() => toast("Paste your mint address there.")}>Put it on the market →</a>
                  <button className="btn ghost" onClick={close}>Later</button>
                </>
              )}
              {phase.k === "failed" && (
                <>
                  <div className="paneltitle" style={{ marginBottom: 0 }}>Not launched</div>
                  <p className="modalmsg">{phase.message}</p>
                  {phase.sig && <a className="hint" href={isEvm ? explorerTx(cfg, phase.sig) : solscanTx(phase.sig)} target="_blank" rel="noopener noreferrer">View on the explorer ↗</a>}
                  <button className="btn ghost" onClick={close}>Close</button>
                </>
              )}
            </div>
          </div>
        )}
        {picker && <WalletModal onClose={() => setPicker(false)} />}
      </div>
      <LaunchPreview name={f.name} symbol={f.symbol} description={pf.description ?? ""} iconUrl={icon} supply={supplyBig} links={pf} />
    </div>
  );
}

/** Small chain logo with a coloured fallback when the icon can't load. */
export function ChainLogo({ c, size = 22 }: { c: Chain; size?: number }) {
  const [bad, setBad] = useState(false);
  if (bad) return <span className="cl-fallback" style={{ width: size, height: size, background: c.color, fontSize: size * 0.5 }}>{c.name.charAt(0)}</span>;
  // eslint-disable-next-line @next/next/no-img-element -- a small public chain icon
  return <img src={c.logo} alt="" width={size} height={size} className="cl-img" style={{ width: size, height: size }} referrerPolicy="no-referrer" onError={() => setBad(true)} />;
}

/** The chain picker: one button showing the chosen chain, and a list of all of them with their logos. */
function ChainSelect({ value, onChange }: { value: ChainId; onChange: (c: ChainId) => void }) {
  const [open, setOpen] = useState(false);
  const cur = CHAINS[value];
  return (
    <div className="lx-chainsel" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <span className="flabel">Chain</span>
      <button type="button" className="lx-chainbtn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <ChainLogo c={cur} size={26} />
        <span className="lx-chainname"><b>{cur.name}</b></span>
        <i aria-hidden="true">▾</i>
      </button>
      {open && (
        <div className="lx-chainlist" role="listbox" aria-label="Chain">
          {CHAIN_LIST.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={c.id === value} className={`lx-chainopt${c.id === value ? " on" : ""}`} onClick={() => { onChange(c.id); setOpen(false); }}>
              <ChainLogo c={c} size={24} />
              <span><b>{c.name}</b><small>{c.native}</small></span>
              {c.id === value && <em aria-hidden="true">✓</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, err, children }: { label: string; err?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="flabel">{label}</span>
      {children}
      {err && <span className="inlineerr">{err}</span>}
    </div>
  );
}
function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="trustrow">
      <span className="k">{k}</span>
      <span className={`v${mono ? " mono" : ""}`} style={{ wordBreak: "break-all" }}>{v}</span>
    </div>
  );
}
