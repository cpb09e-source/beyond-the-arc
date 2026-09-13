/**
 * The facts /sources, /terms and /privacy share, in one place.
 *
 * BRACKETED VALUES ARE PLACEHOLDERS, NOT COPY. Each is a fact the code cannot
 * supply and a person has to. Before the site is promoted, search the rendered
 * pages for "[" and fill every one in here. docs/TODO-legal-sources.md lists
 * them with the reason each is still open.
 *
 * THE CONTACT ADDRESS IS THE ROLE ADDRESS Colin chose on 2026-09-13, the same
 * one /pricing prints. It is the takedown route the headshot decision depends on
 * (TODO-legal-sources.md section 2.4), so its inbox has to actually receive mail.
 */

/** Who the terms are with and who is responsible under the privacy page. */
export const LEGAL_ENTITY = "[LEGAL ENTITY NAME]";

/** Corrections, takedowns, billing questions, data requests. */
export const CONTACT_EMAIL = "hello@btacbb.xyz";

export function ContactEmail() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-coral hover:underline">{CONTACT_EMAIL}</a>
  );
}

/** An outbound link, styled like the page's own links, opening in a new tab. */
export function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-coral hover:underline">
      {children}
    </a>
  );
}
