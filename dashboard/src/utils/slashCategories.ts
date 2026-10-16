import type { SlashCommandSpec } from "../api/modules/slash";

/** Mirrors backend ``CATEGORY_ORDER`` in ``slash/catalog.py``. */
export const SLASH_CATEGORY_ORDER = [
  "core",
  "skills",
  "session",
  "media",
  "system",
  "debug",
] as const;

export type SlashCategory = (typeof SLASH_CATEGORY_ORDER)[number];

const CATEGORY_LABELS: Record<SlashCategory, { en: string; zh: string }> = {
  core: { en: "Core", zh: "Core commands" },
  skills: { en: "Skills", zh: "Skills" },
  session: { en: "Sessions", zh: "Session management" },
  media: { en: "Media", zh: "Multimedia" },
  system: { en: "System", zh: "System" },
  debug: { en: "Debug", zh: "Debugging" },
};

export function slashCategoryLabel(category: string, locale: string): string {
  const key = category as SlashCategory;
  const labels = CATEGORY_LABELS[key];
  if (!labels) return category;
  return locale.startsWith("zh") ? labels.zh : labels.en;
}

export interface SlashMenuGroup<T> {
  category: string;
  label: string;
  items: T[];
}

/** Group menu rows by category in catalog order (empty categories omitted). */
export function groupSlashByCategory<T extends { spec: SlashCommandSpec }>(
  items: T[],
  locale: string,
): SlashMenuGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const cat = item.spec.category || "system";
    const list = buckets.get(cat);
    if (list) list.push(item);
    else buckets.set(cat, [item]);
  }
  return SLASH_CATEGORY_ORDER.filter((cat) => buckets.has(cat)).map((cat) => ({
    category: cat,
    label: slashCategoryLabel(cat, locale),
    items: buckets.get(cat)!,
  }));
}
