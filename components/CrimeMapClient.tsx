"use client";

import dynamic from "next/dynamic";

export const CrimeMap = dynamic(() => import("@/components/CrimeMap").then((m) => m.CrimeMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
    </div>
  ),
});
