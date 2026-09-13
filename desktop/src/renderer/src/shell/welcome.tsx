import { ArrowUpRight } from "lucide-react";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import { useAccount } from "./account";

/**
 * The first thing an installed copy shows, until someone signs in.
 *
 * ONE ACTION. The account lives on btacbb.xyz, so signing in is a trip to the
 * browser and back: the app never asks for a password, and says so, because a
 * desktop app that asks for one is how people learn to type passwords into
 * things that are not the site.
 *
 * EACH STATE SAYS WHAT HAPPENS NEXT. Waiting names the page to finish on and
 * offers it again, since browsers open behind other windows. A refusal says
 * why, and that nothing is wrong with the account. An error says what to try.
 */

const buttonPrimary =
  "inline-flex h-[36px] items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-white transition-[filter] hover:brightness-110 focus-visible:outline-offset-2";
const buttonQuiet =
  "inline-flex h-[32px] items-center justify-center rounded-md px-3 text-[13px] text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink";

export function Welcome() {
  const { auth, version } = useAccount();

  return (
    <div className="flex h-full flex-col bg-paper">
      {/* The window still moves by its top edge, and the caption buttons sit on it. */}
      <div className="drag h-[40px] shrink-0" />

      <div className="grid min-h-0 flex-1 place-items-center px-6 pb-14">
        <div key={auth.status} className="welcome-in flex w-full max-w-[400px] flex-col items-center text-center">
          <img src={logoOnLight} alt="Beyond the Arc" draggable={false} className="bta-logo-light h-[30px] w-auto" />
          <img src={logoOnDark} alt="Beyond the Arc" draggable={false} className="bta-logo-dark h-[30px] w-auto" />

          {auth.status === "waiting" ? (
            <>
              <h1 className="mt-9 text-[21px] font-semibold tracking-[-0.015em] text-ink">Finish in your browser</h1>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
                Choose Allow on the page that just opened. This window carries on by itself once you do.
              </p>
              <div className="mt-7 flex flex-col items-center gap-1.5">
                <button type="button" onClick={() => void window.bta.auth.signIn()} className={buttonPrimary}>
                  Open the page again
                  <ArrowUpRight size={15} strokeWidth={2} />
                </button>
                <button type="button" onClick={() => void window.bta.auth.cancel()} className={buttonQuiet}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="mt-9 text-[21px] font-semibold tracking-[-0.015em] text-ink">
                {auth.status === "refused" ? "Not open to this account yet" : "Welcome to Beyond the Arc"}
              </h1>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
                {auth.status === "refused"
                  ? "The desktop app is in early access. Your account keeps working on btacbb.xyz exactly as it does today."
                  : "Sign in with your btacbb.xyz account. It opens in your browser, so this app never sees your password."}
              </p>
              {auth.status === "error" && (
                <p role="alert" className="mt-4 rounded-md bg-[color-mix(in_oklab,var(--bad)_10%,var(--card))] px-3 py-2 text-[12.5px] text-bad">
                  {auth.message}
                </p>
              )}
              <div className="mt-7">
                <button type="button" onClick={() => void window.bta.auth.signIn()} className={buttonPrimary}>
                  {auth.status === "refused" ? "Use a different account" : "Sign in with browser"}
                  <ArrowUpRight size={15} strokeWidth={2} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="pb-4 text-center text-[11px] text-ink-muted tabular">{version ? `Version ${version}` : ""}</footer>
    </div>
  );
}
