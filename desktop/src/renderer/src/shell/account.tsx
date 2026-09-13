import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthState, UpdateState } from "../../../preload";

/**
 * The main process's view of the account and of updates, mirrored for the page.
 *
 * MAIN OWNS BOTH. Tokens never enter the renderer; this only listens to what
 * main says and calls what main exposes. Every surface that shows an account or
 * an update reads it from here, so the sidebar, the welcome screen and a gated
 * season cannot disagree about whether someone is signed in.
 */

export type Account = {
  auth: AuthState;
  update: UpdateState;
  version: string;
  /** An installed build opens nothing until someone signs in; development opens straight in. */
  requiresAccount: boolean;
  /** False until the first read from main returns, so nothing flashes a signed-out state. */
  ready: boolean;
};

const initial: Account = {
  auth: { status: "signedOut" },
  update: { status: "idle" },
  version: "",
  requiresAccount: false,
  ready: false,
};

const AccountContext = createContext<Account>(initial);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account>(initial);

  useEffect(() => {
    let live = true;
    // An event that lands before the first read is newer than that read.
    let heardAuth = false;
    let heardUpdate = false;
    const offAuth = window.bta.auth.onChange((auth) => {
      heardAuth = true;
      setAccount((a) => ({ ...a, auth }));
    });
    const offUpdate = window.bta.update.onChange((update) => {
      heardUpdate = true;
      setAccount((a) => ({ ...a, update }));
    });
    void Promise.all([
      window.bta.auth.state(),
      window.bta.update.state(),
      window.bta.version(),
      window.bta.requiresAccount(),
    ]).then(([auth, update, version, requiresAccount]) => {
      if (!live) return;
      setAccount((a) => ({
        auth: heardAuth ? a.auth : auth,
        update: heardUpdate ? a.update : update,
        version,
        requiresAccount,
        ready: true,
      }));
    });
    return () => {
      live = false;
      offAuth();
      offUpdate();
    };
  }, []);

  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

export const useAccount = (): Account => useContext(AccountContext);

/** Two letters for an avatar: from the email's name, or the app's own. */
export function accountInitials(auth: AuthState): string {
  if (auth.status !== "signedIn" || !auth.user.email) return "BA";
  const local = auth.user.email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : local.slice(0, 2);
  return letters.toUpperCase() || "BA";
}
