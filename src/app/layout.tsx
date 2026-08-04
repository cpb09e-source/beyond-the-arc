import type { Metadata } from "next";
import { Geist, Geist_Mono, Roboto_Slab } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ScoreTicker } from "@/components/scoreboard/score-ticker";
import { SiteFooter } from "@/components/site-footer";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

// Display face — Roboto Slab, replacing Moneta Sans Bold.
//
// Variable rather than a fixed cut, so the 700 that .font-display asks for in
// globals.css is the real 700 on the weight axis instead of a nearest-match.
// Moneta was mapped to both 400 and 700 so every heading rendered Bold whatever
// weight it requested; a variable face reaches the same place honestly.
//
// next/font/google downloads and self-hosts at build time, so this stays a
// same-origin asset with no request to Google at runtime, same as the local
// file it replaces. Subset to latin to keep it near Moneta's 24.5 KB.
//
// public/fonts/MonetaSans-Bold.woff2 and its .otf source are left in the repo.
const robotoSlab = Roboto_Slab({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://beyond-the-arc.netlify.app";
const OG_IMAGE = "/images/bta_open_graph-01.png";
const SITE_DESCRIPTION =
  "Editorial-grade college basketball analytics: team and player splits, shot charts, lineup data, and the transfer portal.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Beyond the Arc — College Basketball Analytics",
    template: "%s · Beyond the Arc",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Beyond the Arc",
    title: "Beyond the Arc — College Basketball Analytics",
    description: SITE_DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1440, height: 756, alt: "Beyond the Arc" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Beyond the Arc — College Basketball Analytics",
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${robotoSlab.variable} h-full antialiased`}
    >
      <head>
        {/* Dark mode is off for now. The palette lives on in globals.css
            under [data-theme="dark"] and ThemeToggle still exists, so turning
            it back on means restoring this script and re-mounting the control.
            Nothing sets data-theme any more — which matters, because this
            script used to default EVERY phone (<768px) to dark, and a stored
            'bta-theme=dark' would otherwise strand a returning visitor in a
            palette with no control left to leave it. */}
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <SiteHeader />
        {/* Score rail, under the nav on every page. Renders nothing when there
            are no games, so it costs zero height in the offseason. In demo mode
            it reads one baked static file rather than the function, so having
            it on every page costs a cached asset instead of a CBBD round trip
            (see src/lib/flags.ts). */}
        <ScoreTicker />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
