"use client";

import { MapPin } from "lucide-react";

export function SearchPopupContent({
  label,
  useIcons,
}: {
  label: string;
  useIcons: boolean;
}) {
  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-2">
        {useIcons ? (
          <MapPin size={16} strokeWidth={2} className="shrink-0 opacity-90" />
        ) : null}
        <div className="min-w-0 font-[750] text-[13px] leading-tight text-white/95">
          {label}
        </div>
      </div>
    </div>
  );
}
