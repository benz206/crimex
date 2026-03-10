"use client";

import dynamic from "next/dynamic";
import { HomeOverlayNav } from "@/components/HomeOverlayNav";

const CrimeMap = dynamic(() => import("@/components/CrimeMap").then((m) => m.CrimeMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
    </div>
  ),
});

export default function Home() {
  return (
    <div className="relative h-dvh w-full bg-black">
      <HomeOverlayNav />
      <CrimeMap />
    </div>
  );
}
