import type { Metadata } from "next";
import { SignupClient } from "@/components/account/signup-client";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a free Beyond the Arc account.",
  alternates: { canonical: "/account/signup/" },
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return <SignupClient />;
}
