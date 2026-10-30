// Local icon references never escape into the portable backup format.
export type IconMap = Readonly<Record<string, string>>;
export const ICONS = "laterOnIcons";
const PREFIX = "icon://";

export const isInlineIcon = (value: unknown): value is string => typeof value === "string" && /^data:image\//i.test(value);
export const isIconReference = (value: unknown): value is string => typeof value === "string" && value.startsWith(PREFIX);
export const iconId = (value: string | undefined): string | null =>
  value && /^icon:\/\/[a-f0-9]{64}$/.test(value) ? value.slice(PREFIX.length) : null;

export function resolveFavicon(value: string | undefined, icons: IconMap): string {
  if (!isIconReference(value)) return value || "";
  const id = iconId(value);
  return id && Object.hasOwn(icons, id) && isInlineIcon(icons[id]) ? icons[id]! : "";
}

export function referencedIcons(items: readonly { readonly favicon?: string }[], icons: IconMap): IconMap {
  const ids = new Set(items.map(item => iconId(item.favicon)).filter((id): id is string => id !== null));
  return Object.fromEntries(Object.entries(icons).filter(([id]) => ids.has(id)));
}

const digest = async (value: string): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
};

/** No I/O or input mutation. Hash each distinct inline value once per operation. */
export async function internIcons<T extends { readonly favicon?: string }>(items: readonly T[], existing: IconMap): Promise<{ readonly items: readonly T[]; readonly icons: IconMap }> {
  const icons = { ...existing };
  const replacements = new Map<string, string>();
  for (const value of new Set(items.map(item => item.favicon).filter(isInlineIcon))) {
    try {
      const id = await digest(value);
      // Keep the inline original if hashing fails or an existing digest disagrees.
      if (Object.hasOwn(icons, id) && icons[id] !== value) continue;
      icons[id] = value;
      replacements.set(value, `${PREFIX}${id}`);
    } catch { /* A hash failure must not discard a usable image. */ }
  }
  const next = items.map(item => {
    const favicon = item.favicon && replacements.get(item.favicon);
    return favicon ? { ...item, favicon } : item;
  });
  return { items: next, icons: referencedIcons(next, icons) };
}
