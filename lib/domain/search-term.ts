/**
 * The stored form of a submitted search (search_terms.term): NFKC, lower case, single
 * spaces, at most 30 characters. Null for input not worth keeping: links, and anything
 * without a letter or Han character.
 */
export function storedSearchTerm(raw: string): string | null {
  const term = raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 30).trim();
  if (!term || /https?:|www\.|\.(?:com|net|tv)\b/.test(term)) return null;
  return /[\p{L}]/u.test(term) ? term : null;
}
