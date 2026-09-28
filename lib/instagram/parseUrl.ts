export type ParseUrlResult =
  | { ok: true; shortcode: string; canonicalUrl: string }
  | { ok: false; message: string };

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

// Path segments that introduce a post shortcode.
const POST_SEGMENTS = new Set(["p", "reel", "reels", "tv"]);

// Public shortcodes are 11 chars; private/older ones can be longer. Keep the bound loose.
const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,64}$/;

// Top-level paths that are Instagram features, not usernames.
const RESERVED_TOP_LEVEL = new Set([
  "explore",
  "accounts",
  "direct",
  "about",
  "developer",
  "legal",
  "web",
  "api",
]);

const MSG = {
  empty: "Paste an Instagram post or reel URL.",
  notUrl: "That doesn't look like a URL. Paste a link like https://www.instagram.com/p/ABC123xyz/",
  notInstagram: "Only instagram.com links are supported.",
  stories: "Stories aren't supported. Paste a link to a post or reel instead.",
  audio: "That's an audio page, not a post. Open a reel that uses it and paste the reel's URL.",
  share:
    "Instagram share links (instagram.com/share/...) can't be resolved directly. Open the link in your browser and paste the final post URL from the address bar.",
  profile: "That looks like a profile URL. Paste a link to a specific post or reel.",
  notPost: "That isn't a post or reel URL. Paste a link like https://www.instagram.com/p/ABC123xyz/",
  badShortcode: "The post code in that URL doesn't look valid.",
} as const;

export function canonicalUrlFor(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/`;
}

export function parseInstagramUrl(input: string): ParseUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: MSG.empty };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: MSG.notUrl };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, message: MSG.notUrl };
  }
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, message: MSG.notInstagram };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase();

  if (!first) return { ok: false, message: MSG.notPost };
  if (first === "stories") return { ok: false, message: MSG.stories };
  if (first === "share" || segments[1]?.toLowerCase() === "share") {
    return { ok: false, message: MSG.share };
  }
  if (first === "reels" && segments[1]?.toLowerCase() === "audio") {
    return { ok: false, message: MSG.audio };
  }

  // The post segment is either first (/p/CODE) or second (/username/p/CODE).
  let postIndex = -1;
  if (POST_SEGMENTS.has(first)) {
    postIndex = 0;
  } else if (!RESERVED_TOP_LEVEL.has(first) && POST_SEGMENTS.has(segments[1]?.toLowerCase() ?? "")) {
    postIndex = 1;
  }

  if (postIndex === -1) {
    if (segments.length <= 2 && !RESERVED_TOP_LEVEL.has(first)) {
      return { ok: false, message: MSG.profile };
    }
    return { ok: false, message: MSG.notPost };
  }

  const shortcode = segments[postIndex + 1];
  if (!shortcode) {
    // e.g. instagram.com/reels/ (the reels feed) or instagram.com/username/reels/ (profile tab)
    return { ok: false, message: postIndex === 1 ? MSG.profile : MSG.notPost };
  }
  if (!SHORTCODE_RE.test(shortcode)) {
    return { ok: false, message: MSG.badShortcode };
  }

  return { ok: true, shortcode, canonicalUrl: canonicalUrlFor(shortcode) };
}
