"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The banner's appearance, in one place.
 *
 * EXTRACTED SO THE PREVIEW CANNOT LIE. The admin page shows an administrator
 * what a banner will look like before it goes across the top of the site for
 * everyone, and a preview drawn by a second copy of these classes is a preview
 * that is right until someone changes one of them. The whole value of the
 * control is that what you see is what ships, so both callers render this.
 *
 * It takes no decision of its own — not whether the banner is enabled, not
 * whether there is a message. SiteBanner decides that for the site and the
 * admin preview decides it for itself, because they want different answers:
 * the site renders nothing when disabled, and the preview must go on showing
 * a disabled banner or there would be nothing to look at while composing one.
 */

export type BannerContent = {
  message: string;
  tone: "info" | "warn";
  href?: string;
  label?: string;
};

export function BannerView({ banner, className }: { banner: BannerContent; className?: string }) {
  return (
    <div
      className={cn(
        "w-full border-b px-4 py-2 text-center text-[0.8125rem]",
        banner.tone === "warn"
          ? "bg-bad/10 border-bad/20 text-bad"
          : "bg-coral/10 border-coral/20 text-ink",
        className,
      )}
    >
      {/* BOLD, because the banner competes with a full page of type below it
          and a thin 13px line across the top reads as chrome rather than as
          something being said. The link keeps its underline as the thing that
          marks it clickable, since weight alone no longer separates it. */}
      <span className="font-bold">{banner.message}</span>
      {banner.href && banner.label && (
        <>
          {" "}
          {/* Absolute URLs get a plain anchor: next/link is for routes inside
              this app, and handing it an external href makes it prefetch
              something it does not own. */}
          {banner.href.startsWith("/") ? (
            <Link href={banner.href} className="font-bold underline underline-offset-2">
              {banner.label}
            </Link>
          ) : (
            <a href={banner.href} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-2">
              {banner.label}
            </a>
          )}
        </>
      )}
    </div>
  );
}
