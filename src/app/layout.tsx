import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
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

// Display face — self-hosted Moneta Sans Bold. Mapped to every weight so any
// heading using the display family always renders in the Bold cut.
const moneta = localFont({
  variable: "--font-display",
  display: "swap",
  src: [
    { path: "../../public/fonts/MonetaSans-Bold.otf", weight: "400", style: "normal" },
    { path: "../../public/fonts/MonetaSans-Bold.otf", weight: "700", style: "normal" },
  ],
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
      className={`${geistSans.variable} ${geistMono.variable} ${moneta.variable} h-full antialiased`}
    >
      <head>
        {/* Pre-hydration theme apply: read localStorage and set
            data-theme on <html> BEFORE first paint so dark-mode users
            don't flash a frame of light-mode tokens. With no saved
            preference, mobile (<768px) defaults to dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('bta-theme');var d=t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(max-width:767px)').matches);if(d)document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
