import type { Metadata } from "next";
import { Schibsted_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ScoreTicker } from "@/components/scoreboard/score-ticker";
import { SiteFooter } from "@/components/site-footer";

/**
 * TYPE: one grotesk for everything that is words, one mono for everything that
 * is a number.
 *
 * The site is a stat table with articles around it, and the old stack had that
 * backwards. Roboto Slab was pinned at 400 — a weight chosen because the swap
 * from Moneta made 700 too heavy, not because 400 was right — and it set the
 * big figures, hanging serifs off columns of digits. Meanwhile Geist Mono, the
 * one face built for numerals, appeared six times on the whole site against 305
 * places that set tabular numbers.
 *
 * Schibsted Grotesk is a Swiss neo-grotesque that carries display weight at 700
 * and 800 and still sets 13px table text cleanly, so display and body are one
 * family and weight does the separating — no second text face to load.
 *
 * IBM Plex Mono takes every number. Its slashed zero and unmistakable 1 vs 7
 * are what a column of 26,000 stat lines actually needs, and .tabular in
 * globals.css routes all 305 of those places here in one rule.
 *
 * next/font self-hosts both at build time and generates a metric-matched local
 * fallback for each, so nothing reflows while they load and no request leaves
 * for Google at runtime.
 */
const sans = Schibsted_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// Same family as --font-sans on purpose; .font-display supplies the weight.
const display = Schibsted_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  // 600 is the display weight (.font-display); 700 stays loaded for the few
  // places that lean on it. A grotesk at 700 was shouting at headline sizes —
  // Schibsted's 600 holds the top of a page without the headline going bold.
  weight: ["500", "600", "700"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  // 700 is loaded because .tabular wins the family on the 35 elements that
  // carry .font-display too — those are the big pull-out figures, and they ask
  // for the display weight. Without a real 700 cut the browser synthesises one,
  // which on a mono smears the very glyphs this face was chosen for.
  weight: ["400", "500", "600", "700"],
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
      className={`${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`}
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
