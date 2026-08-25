import type { Metadata } from "next";
import { ResetClient } from "@/components/account/reset-client";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Beyond the Arc account.",
  alternates: { canonical: "/account/reset/" },
  robots: { index: false, follow: false },
};

export default function ResetPage() {
  return <ResetClient />;
}
