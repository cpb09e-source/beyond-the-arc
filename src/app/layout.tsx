import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
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

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "SOFT"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://beyond-the-arc.netlify.app";
const OG_IMAGE = "/images/nba-cc-open-graph.png";
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
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Beyond the Arc" }],
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
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        {/* Pre-hydration theme apply: read localStorage and set
            data-theme on <html> BEFORE first paint so dark-mode users
            don't flash a frame of light-mode tokens. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('bta-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();",
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
