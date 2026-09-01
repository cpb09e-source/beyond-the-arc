import type { Metadata } from "next";
import { AdminClient } from "@/components/admin/admin-client";

export const metadata: Metadata = {
  title: "Admin",
  description: "Pipeline status and controls.",
  alternates: { canonical: "/admin/" },
  // Same reasoning as /account: the page is empty until a session exists in
  // the browser, so there is nothing here for a crawler to read even if it
  // were welcome. It is not.
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminClient />;
}
