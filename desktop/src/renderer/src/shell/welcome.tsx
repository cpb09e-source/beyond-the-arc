import { ArrowUpRight, Check, Copy, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import { PercentileChip } from "@/components/percentile-chip";
import { Kbd } from "~/ui/kbd";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import { useAccount } from "./account";

/**
 * The door. An installed copy shows this until an account with Season Pass
 * signs in, and never again after that: the session is kept, encrypted, and
 * renewed in the background, so closing the app does not sign anyone out.
 *
 * LINEAR'S SHAPE, ATTIO'S SPLIT. One way in, stated plainly, on the left; on the
 * right, when the window is wide enough, a still of the thing being unlocked,
 * drawn with 2025-26's real numbers rather than a marketing illustration.
 *
 * THE BROWSER DOES THE SIGNING IN. The account lives on btacbb.xyz, so the app
 * opens the site, the reader presses Allow there, and the app carries on by
 * itself. It never asks for a password, and says so, because a desktop app that
 * asks for one is how people learn to type passwords into things that are not
 * the site.
 *
 * EACH STATE SAYS WHAT HAPPENS NEXT. Waiting names the three steps and offers
 * the page again, or its link, since browsers open behind other windows. A free
 * account is told what the app comes with and how to get it. An error says what
 * to try.
 */

const SITE = "https://btacbb.xyz";

const primary =
  "inline-flex h-[40px] w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[13.5px] font-medium text-white shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_1px_2px_rgb(0_0_0/0.12)] transition-[filter] hover:brightness-110 focus-visible:outline-offset-2";
const secondary =
  "inline-flex h-[38px] w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-card px-4 text-[13px] font-medium text-ink transition-colors hover:border-[color-mix(in_oklab,var(--ink-muted)_45%,var(--hairline))]";
const quiet =
  "inline-flex h-[30px] items-center justify-center rounded-md px-2.5 text-[12.5px] text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink";
const inlineLink = "font-medium text-ink underline decoration-hairline underline-offset-[3px] transition-colors hover:decoration-ink-muted";

export function Welcome() {
  const { auth, version } = useAccount();

  return (
    <div className="flex h-full bg-paper">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The window still moves by its top edge. */}
        <div className="drag h-[40px] shrink-0" />
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-8 pb-8">
          <div key={auth.status} className="welcome-in w-full max-w-[340px]">
            <img src={logoOnLight} alt="Beyond the Arc" draggable={false} className="bta-logo-light h-[26px] w-auto" />
            <img src={logoOnDark} alt="Beyond the Arc" draggable={false} className="bta-logo-dark h-[26px] w-auto" />
            {auth.status === "waiting" ? <Waiting /> : auth.status === "refused" ? <Refused /> : <SignIn error={auth.status === "error" ? auth.message : null} />}
          </div>
        </div>
        <footer className="flex items-center justify-between px-6 pb-4 text-[11px] text-ink-muted">
          <span className="tabular">{version ? `Version ${version}` : ""}</span>
          <span className="flex items-center gap-3">
            <button type="button" onClick={() => void window.open(`${SITE}/terms/`)} className="transition-colors hover:text-ink">
              Terms
            </button>
            <button type="button" onClick={() => void window.open(`${SITE}/privacy/`)} className="transition-colors hover:text-ink">
              Privacy
            </button>
          </span>
        </footer>
      </div>
      <Showcase />
    </div>
  );
}

function Heading({ children, eyebrow }: { children: ReactNode; eyebrow?: ReactNode }) {
  return (
    <>
      {eyebrow && <div className="mt-9">{eyebrow}</div>}
      <h1 className={`${eyebrow ? "mt-3" : "mt-9"} text-balance text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink`}>{children}</h1>
    </>
  );
}

function SignIn({ error }: { error: string | null }) {
  return (
    <>
      <Heading>Log in to Beyond the Arc</Heading>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
        Use your btacbb.xyz account. You finish in your browser and come straight back here, so this app never sees your password.
      </p>
      {error && (
        <p role="alert" className="mt-5 rounded-lg bg-[color-mix(in_oklab,var(--bad)_10%,var(--card))] px-3 py-2.5 text-[12.5px] leading-snug text-bad">
          {error}
        </p>
      )}
      <div className="mt-7">
        <button type="button" autoFocus onClick={() => void window.bta.auth.signIn()} className={primary}>
          Continue with browser
          <ArrowUpRight size={15} strokeWidth={2} />
        </button>
      </div>
      <p className="mt-4 text-[12.5px] text-ink-muted">
        New to Beyond the Arc?{" "}
        <button type="button" onClick={() => void window.open(`${SITE}/account/signup/`)} className={inlineLink}>
          Create an account
        </button>
      </p>
      <div className="mt-9 border-t border-hairline pt-4 text-[12px] leading-relaxed text-ink-muted">
        The desktop app comes with Season Pass.{" "}
        <button type="button" onClick={() => void window.open(`${SITE}/pricing/`)} className={inlineLink}>
          See plans
        </button>
      </div>
    </>
  );
}

function Waiting() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (await window.bta.auth.copyLink()) setCopied(true);
  };

  const steps = ["Sign in on btacbb.xyz, if you are not already", "Choose Allow", "Come back here; this window carries on by itself"];
  return (
    <>
      <Heading eyebrow={<span className="ask-orb" aria-hidden />}>Check your browser</Heading>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">We opened btacbb.xyz in your browser to finish signing in.</p>
      <ol className="mt-6 flex flex-col gap-2.5">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-[13px] text-ink-soft">
            <span className="mt-px grid size-[20px] shrink-0 place-items-center rounded-full border border-hairline bg-card text-[11px] font-semibold text-ink tabular">
              {i + 1}
            </span>
            <span className="leading-[1.45]">{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-7 flex flex-col gap-2">
        <button type="button" onClick={() => void window.bta.auth.signIn()} className={secondary}>
          Open the page again
          <ArrowUpRight size={15} strokeWidth={2} />
        </button>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => void copy()} className={quiet}>
            {copied ? <Check size={13} strokeWidth={2.25} className="mr-1.5 text-good" /> : <Copy size={13} strokeWidth={2} className="mr-1.5" />}
            {copied ? "Link copied" : "Copy the link instead"}
          </button>
          <button type="button" onClick={() => void window.bta.auth.cancel()} className={quiet}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

function Refused() {
  return (
    <>
      <Heading
        eyebrow={
          <span className="inline-flex h-[22px] items-center rounded-full border border-hairline bg-card px-2 text-[11px] font-medium text-ink-muted">
            Signed in on a free plan
          </span>
        }
      >
        The desktop app comes with Season Pass
      </Heading>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
        Season Pass opens every season since 2013-14 on btacbb.xyz, and this app with it: tabs, split view, Ctrl K and the Win Calculator on your desktop.
      </p>
      <div className="mt-7 flex flex-col gap-2">
        <button type="button" autoFocus onClick={() => void window.open(`${SITE}/pricing/`)} className={primary}>
          Get Season Pass
          <ArrowUpRight size={15} strokeWidth={2} />
        </button>
        <button type="button" onClick={() => void window.bta.auth.signIn()} className={secondary}>
          I have subscribed, continue
        </button>
      </div>
      <p className="mt-4 text-[12.5px] text-ink-muted">
        Wrong account?{" "}
        <button type="button" onClick={() => void window.bta.auth.signIn()} className={inlineLink}>
          Sign in with a different one
        </button>
      </p>
    </>
  );
}

/** 2025-26's top five by BTA rank, as the Team Explorer shows them. */
const TOP: Array<{ name: string; adjO: [string, number]; adjD: [string, number]; net: [string, number] }> = [
  { name: "Michigan", adjO: ["129.2", 99], adjD: ["91.3", 100], net: ["+37.9", 100] },
  { name: "Florida", adjO: ["125.3", 98], adjD: ["93.7", 99], net: ["+31.7", 99] },
  { name: "Duke", adjO: ["127.9", 99], adjD: ["91.3", 100], net: ["+36.6", 100] },
  { name: "Arizona", adjO: ["125.5", 98], adjD: ["91.5", 99], net: ["+34.0", 99] },
  { name: "Houston", adjO: ["122.4", 94], adjD: ["91.9", 99], net: ["+30.4", 99] },
];

/** The right half: a still of the workbench, sitting on the chrome ground. */
function Showcase() {
  return (
    <aside aria-hidden className="relative hidden w-[48%] max-w-[680px] shrink-0 flex-col overflow-hidden border-l border-hairline bg-chrome min-[960px]:flex">
      <div className="drag h-[40px] shrink-0" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 70% at 85% 0%, color-mix(in oklab, var(--accent) 9%, transparent), transparent 60%)" }}
      />
      <div className="relative flex min-h-0 flex-1 flex-col justify-center px-10 pb-12">
        <p className="text-[12px] font-medium text-ink-muted">What opens when you sign in</p>
        <h2 className="mt-2 max-w-[420px] text-balance text-[20px] font-semibold leading-snug tracking-[-0.015em] text-ink">
          Every team, player, coach and game since 2013-14, a keystroke apart.
        </h2>

        <div className="mt-8 w-full max-w-[520px] overflow-hidden rounded-xl border border-hairline bg-paper" style={{ boxShadow: "var(--overlay-shadow)" }}>
          <div className="flex h-[34px] items-center gap-1.5 border-b border-hairline bg-chrome px-2.5">
            <span className="flex h-[24px] items-center gap-1.5 rounded-md bg-paper px-2 text-[11.5px] text-ink shadow-[0_0_0_1px_var(--hairline)]">
              Team Explorer <span className="text-[10px] text-ink-muted tabular">25-26</span>
            </span>
            <span className="flex h-[24px] items-center gap-1.5 px-2 text-[11.5px] text-ink-muted">
              <TeamLogo id={logoIdOf("Michigan")} name="Michigan" size={12} />
              Michigan
            </span>
          </div>
          <div className="grid grid-cols-[22px_minmax(0,1fr)_62px_62px_62px] items-center gap-2 border-b border-hairline px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <span className="text-right">#</span>
            <span>Team</span>
            <span className="text-right">Adj O</span>
            <span className="text-right">Adj D</span>
            <span className="text-right">Net</span>
          </div>
          {TOP.map((t, i) => (
            <div
              key={t.name}
              className={`grid grid-cols-[22px_minmax(0,1fr)_62px_62px_62px] items-center gap-2 border-b border-hairline px-3 py-[7px] text-[12px] last:border-b-0 ${
                i === 0 ? "bg-[var(--row-focus)]" : ""
              }`}
            >
              <span className="text-right text-ink-muted tabular">{i + 1}</span>
              <span className="flex min-w-0 items-center gap-2">
                <TeamLogo id={logoIdOf(t.name)} name={t.name} size={16} />
                <span className="truncate font-medium text-ink">{t.name}</span>
              </span>
              {[t.adjO, t.adjD, t.net].map(([v, p], j) => (
                <span key={j} className="flex flex-col items-end gap-[2px] leading-none">
                  <span className={`tabular ${j === 2 ? "font-semibold text-ink" : "text-ink-soft"}`}>{v}</span>
                  <PercentileChip pct={p} className="min-w-[24px] px-1 py-[1px] text-[10px]" />
                </span>
              ))}
            </div>
          ))}
          {/* Room under the last row for the question card that overlaps the frame's edge. */}
          <div className="h-[26px] bg-paper" />
        </div>

        <div
          className="-mt-5 ml-8 flex w-full max-w-[460px] items-center gap-2.5 rounded-lg border border-hairline bg-card px-3 py-2.5 text-[12.5px] text-ink-soft"
          style={{ boxShadow: "var(--overlay-shadow)" }}
        >
          <Sparkles size={14} strokeWidth={2} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">Kansas under Bill Self when they win the fast break battle</span>
          <Kbd>Enter</Kbd>
        </div>

        <ul className="mt-8 grid max-w-[520px] grid-cols-3 gap-4 text-[12px] leading-snug text-ink-muted">
          <li>
            <span className="block font-medium text-ink">Tabs and split view</span>
            Open any two things side by side.
          </li>
          <li>
            <span className="block font-medium text-ink">Ctrl K</span>
            One box for every team, player, coach and night.
          </li>
          <li>
            <span className="block font-medium text-ink">Ask in plain English</span>
            Thirteen seasons of games, answered.
          </li>
        </ul>
      </div>
    </aside>
  );
}
