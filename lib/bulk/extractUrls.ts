import { parseInstagramUrl } from "@/lib/instagram/parseUrl";

export interface ExtractedUrls {
  /** Unique posts, in the order first seen. */
  valid: Array<{ url: string; shortcode: string; canonicalUrl: string }>;
  /** Instagram links that aren't posts/reels (stories, profiles, share links…). */
  invalid: Array<{ url: string; message: string }>;
  /** Links whose post was already listed. */
  duplicates: number;
}

// Instagram links anywhere in free text / CSV / cell values. Stops at whitespace, quotes and
// common CSV/markdown delimiters.
const IG_LINK_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*instagram\.com\/[^\s"'<>,;|)\]]*/gi;

/**
 * Finds Instagram links in any text (a CSV, pasted lines, or joined spreadsheet cells), validates
 * them, and de-duplicates by shortcode. Column layout doesn't matter.
 */
export function extractInstagramUrls(text: string): ExtractedUrls {
  const result: ExtractedUrls = { valid: [], invalid: [], duplicates: 0 };
  const seenCodes = new Set<string>();
  const seenInvalid = new Set<string>();

  for (const match of text.matchAll(IG_LINK_RE)) {
    const url = match[0].replace(/[.!?:]+$/, "");
    const parsed = parseInstagramUrl(url);
    if (!parsed.ok) {
      if (!seenInvalid.has(url)) {
        seenInvalid.add(url);
        result.invalid.push({ url, message: parsed.message });
      }
      continue;
    }
    if (seenCodes.has(parsed.shortcode)) {
      result.duplicates += 1;
      continue;
    }
    seenCodes.add(parsed.shortcode);
    result.valid.push({ url, shortcode: parsed.shortcode, canonicalUrl: parsed.canonicalUrl });
  }
  return result;
}
