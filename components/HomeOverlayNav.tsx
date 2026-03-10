"use client";

import Link from "next/link";
import { AuthButton } from "@/components/AuthButton";

export function HomeOverlayNav() {
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 p-3">
      <div className="pointer-events-auto mx-auto flex w-full max-w-[1100px] items-center justify-between gap-2">
        <Link href="/" className="ui-btn h-9 px-3 text-[13px]">
          Crime Map
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/markets" className="ui-btn h-9 px-3 text-[13px]">
            Markets
          </Link>
          <Link href="/predictions" className="ui-btn h-9 px-3 text-[13px]">
            Predictions
          </Link>
          <AuthButton />
        </div>
      </div>
    </div>
  );
}
