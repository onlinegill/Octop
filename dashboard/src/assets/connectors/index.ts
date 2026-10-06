import dify from "./dify.svg";
import notion from "./notion.png";
import openalex from "./openalex.svg";

export const CONNECTOR_LOGOS: Record<string, string> = {
  notion,
  openalex,
  dify,
};

export function getConnectorLogo(kind: string): string | undefined {
  if (!kind) return undefined;
  const direct = CONNECTOR_LOGOS[kind];
  if (direct) return direct;
  const normalized = kind.toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized !== kind) {
    const fallback = CONNECTOR_LOGOS[normalized];
    if (fallback) return fallback;
  }
  return undefined;
}
