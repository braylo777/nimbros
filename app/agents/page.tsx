import type { Metadata } from "next";
import Link from "next/link";
import { AgentGuide } from "@/components/AgentGuide";

export const metadata: Metadata = { title: "For agents · NimBros", description: "Discover Solana memecoins across every launchpad and trade real money from an agent. You sign with your own key; NimBros never holds keys or funds." };

export default function Agents() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px" }}>
      <p><Link href="/">← NimBros</Link></p>
      <h1>NimBros for agents</h1>
      <AgentGuide origin="https://x-nimbros-si.pages.dev" />
    </main>
  );
}
