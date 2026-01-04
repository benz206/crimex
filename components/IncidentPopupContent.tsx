"use client";

import type { CSSProperties } from "react";
import {
  Car,
  CheckCircle2,
  CircleHelp,
  DoorOpen,
  Home,
  ShieldAlert,
  ShoppingBag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  formatCity,
  formatIncidentDate,
  formatIncidentDescription,
  getIncidentStyle,
} from "@/lib/incidentStyle";

const categoryIcon: Record<string, LucideIcon> = {
  "Break & Enter": DoorOpen,
  Violence: ShieldAlert,
  Theft: ShoppingBag,
  Traffic: Car,
  "Impaired/Checks": CheckCircle2,
  Property: Home,
  Other: CircleHelp,
};

const isRoadsideTest = (desc?: string) => {
  const d = (desc ?? "").trim().toUpperCase();
  return d === "ROADSIDE TEST" || d === "ROAD TEST" || d === "ROADTEST";
};

export function IncidentPopupContent({
  p,
  useIcons,
}: {
  p: Record<string, unknown>;
  useIcons: boolean;
}) {
  type CSSVarStyle = CSSProperties & { "--incident-color"?: string };
  const rawDesc = typeof p.DESCRIPTION === "string" ? p.DESCRIPTION : "";
  const rawCity = typeof p.CITY === "string" ? p.CITY : "";
  const rawDate = typeof p.DATE === "number" ? p.DATE : undefined;
  const rawCaseNo =
    typeof p.CASE_NO === "string" || typeof p.CASE_NO === "number"
      ? String(p.CASE_NO)
      : "";
  const caseNo = rawCaseNo.trim();
  const title = formatIncidentDescription(rawDesc) || "Incident";
  const city = formatCity(rawCity) || "";
  const date = formatIncidentDate(rawDate) || "";
  const style = getIncidentStyle(rawDesc);
  const Icon = categoryIcon[style.category] ?? CircleHelp;
  const note = isRoadsideTest(rawDesc)
    ? "Roadside tests are police screening checks and aren’t necessarily a reported incident."
    : "";

  const bl = [city, caseNo ? `Case #${caseNo}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="min-w-[220px]"
      style={{ "--incident-color": style.color } as CSSVarStyle}
    >
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {useIcons ? (
            <Icon size={16} strokeWidth={2} className="shrink-0 opacity-90" />
          ) : null}
          <div className="min-w-0 font-[750] text-[13px] leading-tight text-white/95">
            {title}
          </div>
        </div>

        <div className="inline-flex items-center gap-2 self-start whitespace-nowrap rounded-full bg-white/5 px-2.5 py-1 text-[11px] leading-4 text-white/85 ring-1 ring-white/10">
          <span
            className="h-2 w-2 rounded-full shadow-[0_0_0_2px_rgba(0,0,0,0.25)]"
            style={{ backgroundColor: style.color }}
          />
          <span>{style.category}</span>
        </div>

        {bl ? (
          <div className="min-w-0 truncate text-[11px] leading-4 text-white/70">
            {bl}
          </div>
        ) : null}

        {date ? (
          <div className="whitespace-nowrap text-[11px] leading-4 text-white/70">
            {date}
          </div>
        ) : null}

        {note ? (
          <div className="rounded-[10px] bg-white/5 px-2.5 py-2 text-[11px] leading-4 text-white/70 ring-1 ring-white/10">
            {note}
          </div>
        ) : null}
      </div>
    </div>
  );
}
