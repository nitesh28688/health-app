// Normalized lookup key for matching products across the shelf and the shared
// ingredient cache — case/punctuation/whitespace-insensitive so "CeraVe Foaming
// Cleanser" and "cerave foaming cleanser!" resolve to the same entry.
export function normalizeProductKey(name: string, brand?: string | null): string {
  const clean = (s: string) => s.toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
  return brand?.trim() ? `${clean(brand)}|${clean(name)}` : clean(name);
}
