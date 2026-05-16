"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccessToken } from "@/lib/useAccessToken";
import type { ReactNode } from "react";

type NavBarProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
};

const links: Array<{ href: string; label: string; match: (path: string) => boolean }> = [
  { href: "/", label: "Map", match: (p) => p === "/" },
  { href: "/markets", label: "Markets", match: (p) => p.startsWith("/markets") },
  { href: "/predictions", label: "Predictions", match: (p) => p.startsWith("/predictions") },
];

export function NavBar({ title, subtitle, backHref, backLabel }: NavBarProps) {
  const pathname = usePathname() ?? "/";
  const token = useAccessToken();

  return (
    <header className="mb-4">
      <nav
        aria-label="Primary"
        className="-mx-1 flex items-center gap-1 overflow-x-auto pb-2"
      >
        {backHref && (
          <Link
            className="ui-btn h-9 shrink-0 px-3 text-[13px]"
            href={backHref}
            aria-label={backLabel ?? "Back"}
          >
            ← {backLabel ?? "Back"}
          </Link>
        )}
        {links.map((link) => {
          const active = link.match(pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`ui-btn h-9 shrink-0 px-3 text-[13px] ${
                active ? "bg-white/[0.16] border-(--stroke-strong)" : ""
              }`}
            >
              {link.label}
            </Link>
          );
        })}
        <div className="grow" />
        <Link
          className="ui-btn h-9 shrink-0 px-3 text-[13px]"
          href={token ? "/profile" : "/login"}
        >
          {token ? "Profile" : "Sign in"}
        </Link>
      </nav>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold text-(--foreground)">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 truncate text-[11px] leading-4 text-(--muted-2)">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="ui-divider mt-4" />
    </header>
  );
}
