import type { Metadata } from "next";
import { LoginClient } from "@/components/account/login-client";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Beyond the Arc.",
  alternates: { canonical: "/account/login/" },
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginClient />;
}
