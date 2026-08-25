import { Suspense } from "react";
import type { Metadata } from "next";
import { ConfirmClient } from "@/components/account/confirm-client";

export const metadata: Metadata = {
  title: "Confirm your email",
  description: "Confirm your Beyond the Arc account.",
  alternates: { canonical: "/account/confirm/" },
  robots: { index: false, follow: false },
};

/**
 * ConfirmClient reads the `plan` query param, and useSearchParams() forces a
 * Suspense boundary under static export. The fallback is null on purpose: this
 * page is a two-second waypoint between an inbox and the dashboard, and a
 * skeleton would flash for longer than the state it describes.
 */
export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmClient />
    </Suspense>
  );
}
