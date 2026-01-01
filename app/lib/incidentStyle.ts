export type IncidentStyle = {
  category: string;
  color: string;
};

import { INCIDENT_TYPE_CHOICES } from "@/app/lib/incidentTypes";

function normalize(s?: string) {
  return (s ?? "").trim();
}

const incidentTypeLabelByKey = new Map(
  INCIDENT_TYPE_CHOICES.map((c) => [normalize(c.value).toUpperCase(), c.label])
);

function isAllLetters(s: string) {
  return /^[A-Za-z]+$/.test(s);
}

function titleCaseToken(token: string) {
  if (!token) return token;
  if (token.includes("$") || /\d/.test(token)) return token;
  if (token === token.toUpperCase() && token.length <= 4 && isAllLetters(token)) return token;
  if (token.includes("&") || token.includes("/")) return token;
  const lower = token.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function formatTitleCase(input?: string) {
  const s = normalize(input);
  if (!s) return "";
  return s
    .split(/\s+/g)
    .map((part) =>
      part
        .split("-")
        .map((tok) => titleCaseToken(tok))
        .join("-")
    )
    .join(" ");
}

export function formatCity(input?: string) {
  return formatTitleCase(input);
}

export function formatIncidentDescription(input?: string) {
  const s = normalize(input);
  if (!s) return "";
  return incidentTypeLabelByKey.get(s.toUpperCase()) ?? formatTitleCase(s);
}

export function formatIncidentDate(ms?: number) {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function getIncidentStyle(description?: string): IncidentStyle {
  const d = normalize(description).toUpperCase();
  if (!d) return { category: "Other", color: "#94A3B8" };

  if (d.includes("BREAK") && d.includes("ENTER")) return { category: "Break & Enter", color: "#EF4444" };
  if (d.includes("ROBBERY") || d.includes("ASSAULT")) return { category: "Violence", color: "#A855F7" };
  if (d.includes("THEFT")) return { category: "Theft", color: "#F59E0B" };
  if (d.includes("MVC") || d.includes("MOTOR VEHICLE") || d.includes("HIT & RUN")) return { category: "Traffic", color: "#3B82F6" };
  if (d.includes("IMPAIRED") || d.includes("ROAD") || d.includes("ROADSIDE") || d.includes("RIDE")) return { category: "Impaired/Checks", color: "#14B8A6" };
  if (d.includes("PROPERTY") || d.includes("MISCHIEF") || d.includes("DAMAGE")) return { category: "Property", color: "#F472B6" };

  return { category: "Other", color: "#94A3B8" };
}


