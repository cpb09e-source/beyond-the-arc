"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-provider";

/**
 * The account control in the header's right cluster.
 *
 * Deliberately NOT an eighth entry in NAV. The comment on that array is
 * load-bearing — seven labels plus the wordmark and the search box already
 * need about 990px, and the row pushed the page sideways at md when it held
 * six. This sits with search and the hamburger instead, at the same 36px as
 * its neighbours, so the nav's width budget is untouched.
 *
 * Renders nothing at all while the session is resolving. A control that says
 * "Sign in" for one frame and then flips to an avatar is worse than a control
 * that arrives a beat late, because the first one reads as being signed out.
 */
export function AccountNav() {
  const { status, session, profile } = useAuth();

  if (status === "loading") {
    return <span className="w-9 h-9 shrink-0" aria-hidden />;
  }

  if (status === "signedOut") {
    return (
      <>
        {/* Nothing at all below lg. The full-screen menu carries Sign in and
            Sign up as full-width buttons at the bottom, where a thumb reaches,
            so repeating them in the header only crowds a row that also holds
            the wordmark, search and the hamburger.

            The lg band (1024-1279) gets the icon: the nav is visible there and
            seven labels plus the wordmark and search already fill the row, so a
            text control pushed the page into a sideways scroll. At xl there is
            room for words — "Log in" as text, "Sign up" as a pill. */}
        <Link
          href="/account/login/"
          className="hidden xl:inline-flex items-center h-9 shrink-0 whitespace-nowrap px-1 sm:px-2 text-[0.8125rem] font-medium text-ink-muted hover:text-ink transition-colors"
        >
          Log in
        </Link>
        <Link
          href="/account/login/"
          aria-label="Sign in"
          title="Sign in"
          className="hidden lg:inline-flex xl:hidden items-center justify-center w-9 h-9 rounded-md text-ink hover:bg-paper-deep transition-colors"
        >
          <UserIcon />
        </Link>
        <Link
          href="/pricing/"
          className="hidden xl:inline-flex items-center justify-center h-9 shrink-0 whitespace-nowrap rounded-full bg-coral px-4 text-[0.8125rem] font-semibold text-white hover:bg-coral-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2"
        >
          Sign up
        </Link>
      </>
    );
  }

  const email = profile?.email ?? session?.user?.email ?? "";
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <Link
      href="/account/"
      aria-label={`Your account (${email})`}
      title={email}
      className="inline-flex items-center justify-center w-9 h-9 shrink-0"
    >
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-ink text-paper text-xs font-semibold ring-1 ring-ink/10 hover:bg-ink/85 transition-colors"
        aria-hidden
      >
        {initial}
      </span>
    </Link>
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
