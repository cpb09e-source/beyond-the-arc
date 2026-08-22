import type { Metadata } from "next";
import { AccountClient } from "@/components/account/account-client";

export const metadata: Metadata = {
  title: "Your account",
  description: "Your Beyond the Arc membership.",
  alternates: { canonical: "/account/" },
  // Nothing under /account has anything to offer a crawler: every page is
  // empty until a session exists in the browser.
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountClient />;
}
