import type { Metadata } from "next";
import { Newsreader, Public_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal"],
  weight: ["400", "500", "600"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export const metadata: Metadata = {
  title: "NimBros | Trade",
  description: "Trade Safely. Memecoin trading with a security shield on your wallet: pre-sign screening, approval revoking, wallet tracking, every launchpad.",
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${publicSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* start fetching the token lists while the page's code is still loading (the client reads them from here) */}
        <link rel="preload" as="fetch" href="/api/feed?k=snipe" crossOrigin="anonymous" />
        <link rel="preload" as="fetch" href="/api/feed?k=scalp" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://dd.dexscreener.com" />
      </head>
      <body>{children}</body>
    </html>
  );
}
