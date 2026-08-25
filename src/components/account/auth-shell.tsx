"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The frame both auth forms sit in, plus the field and button styling they
 * share. Extracted because sign-in and sign-up are the same object with one
 * field's difference — keeping them as one shape means the pair cannot drift
 * into looking like two different products.
 */
export function AuthShell({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
  /** Optional. A transient state (checking a link, confirming a change) has
   *  nowhere useful to send anyone, and an empty ruled-off strip under it reads
   *  as something that failed to load. */
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[26rem] px-6 py-12 sm:py-16">
      <h1 className="font-display text-2xl sm:text-3xl tracking-tight text-ink text-balance">
        {title}
      </h1>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">{intro}</p>
      <div className="mt-7">{children}</div>
      {footer && (
        <div className="mt-6 pt-5 border-t border-hairline text-sm text-ink-muted">
          {footer}
        </div>
      )}
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  ...props
}: {
  id: string;
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs uppercase tracking-widest font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        {...props}
        /* text-base on phones: iOS Safari zooms the page when a focused field
           sets type smaller than 16px, which on a login form throws the layout
           sideways at the worst moment. */
        className="h-11 px-3 rounded border border-hairline bg-card text-ink text-base sm:text-sm placeholder:text-ink-muted/70 focus:outline-none focus:ring-2 focus:ring-coral/40"
      />
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingLabel,
}: {
  pending: boolean;
  children: React.ReactNode;
  pendingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "h-11 w-full rounded font-semibold text-sm transition-colors",
        "bg-coral text-white hover:bg-coral-soft disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2",
      )}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-coral leading-snug">
      {message}
    </p>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-coral hover:text-coral-soft font-medium">
      {children}
    </Link>
  );
}

/**
 * Supabase's auth errors are written for developers. These are the ones a
 * person can actually hit, in words that say what to do next; anything
 * unmapped falls through verbatim rather than being flattened into a generic
 * "something went wrong", which would hide a real outage.
 */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email and password do not match an account.";
  }
  if (m.includes("user already registered") || m.includes("already been registered")) {
    return "There is already an account with that email. Sign in instead.";
  }
  if (m.includes("password should be at least")) {
    return "Passwords need to be at least 8 characters.";
  }
  if (m.includes("unable to validate email") || m.includes("invalid email")) {
    return "That does not look like a valid email address.";
  }
  if (m.includes("email rate limit") || m.includes("too many requests")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return message;
}
