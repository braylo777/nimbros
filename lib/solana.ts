"use client";

import { Connection } from "@solana/web3.js";

/* Solana connectivity. The browser never talks to an RPC node directly (the page's CSP allows only 'self'
   and it would expose the RPC key): every JSON-RPC call goes through /api/rpc, which allow-lists the
   methods a wallet flow needs and forwards them to the configured node. */

export const NETWORK = "mainnet-beta" as const;

let conn: Connection | null = null;
/** One shared Connection pointed at our own RPC proxy. Client-only: needs `window`. */
export function getConnection(): Connection {
  if (!conn) conn = new Connection(`${window.location.origin}/api/rpc`, { commitment: "confirmed", disableRetryOnRateLimit: true });
  return conn;
}
