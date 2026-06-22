import type { Metadata } from "next";
import { ThirtyTwoZeroClient } from "@/components/thirty-two-zero/game-client";

export const metadata: Metadata = {
  title: "32-0 · Beyond the Arc",
  description:
    "Build an undefeated college basketball lineup. Roll a conference and era, draft a guard, forward, or center, and chase a perfect 32-0 season.",
};

export default function ThirtyTwoZeroPage() {
  return <ThirtyTwoZeroClient />;
}
