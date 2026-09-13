import type { Metadata } from "next";
import { ConnectClient } from "@/components/desktop/connect-client";

export const metadata: Metadata = {
  title: "Connect the desktop app",
  description: "Sign in to Beyond the Arc for Windows with your account.",
  alternates: { canonical: "/desktop/connect/" },
  robots: { index: false, follow: false },
};

export default function DesktopConnectPage() {
  return <ConnectClient />;
}
