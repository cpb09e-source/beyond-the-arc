import type { Metadata } from "next";
import { ForgotClient } from "@/components/account/forgot-client";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for Beyond the Arc.",
  alternates: { canonical: "/account/forgot/" },
  robots: { index: false, follow: false },
};

export default function ForgotPage() {
  return <ForgotClient />;
}
