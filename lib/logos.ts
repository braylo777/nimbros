/* Real token logos, resolved from CoinGecko's asset CDN.
   Keyed by our internal token id. Anything missing falls back to the
   gradient monogram in <Avatar>. */

const CG = "https://coin-images.coingecko.com/coins/images";

export const TOKEN_LOGOS: Record<string, string> = {
  // agent tokens — logo of the memecoin each agent is pegged to
  bonknmbr: `${CG}/28600/large/bonk.jpg`,
  wifnmbr: `${CG}/33566/large/dogwifhat.jpg`,
  popcatnmbr: `${CG}/33760/large/image.jpg`,
  pnutnmbr: `${CG}/51301/large/Peanut_the_Squirrel.png`,
  moodengnmbr: `${CG}/50264/large/MOODENG.jpg`,
  goatnmbr: `${CG}/50717/large/GOAT_LOGO_NEW.jpg`,

  // newly-launched coins in the snipe column
  fartcoin: `${CG}/50891/large/fart.jpg`,
  useless: `${CG}/55684/large/coingeckoupdate.png`,
  cashcat: `${CG}/102174280/large/cashcat-logo.jpg`,
  chump: `${CG}/102175847/large/1000313188.jpg`,
  pippin: `${CG}/51589/large/pippin_logo.png`,
  // hyper: Bitcoin Hyper is presale-stage with no listed token asset —
  // intentionally omitted so it renders the monogram fallback.
};

export function logoFor(id: string): string | undefined {
  return TOKEN_LOGOS[id];
}
