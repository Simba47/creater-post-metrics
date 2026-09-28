import { describe, expect, it } from "vitest";
import { parseInstagramUrl } from "@/lib/instagram/parseUrl";

const CODE = "C8xYz12AbCd";
const CANONICAL = `https://www.instagram.com/p/${CODE}/`;

describe("parseInstagramUrl — accepted", () => {
  const accepted: Array<[string, string]> = [
    ["plain /p/", `https://www.instagram.com/p/${CODE}/`],
    ["no trailing slash", `https://www.instagram.com/p/${CODE}`],
    ["no www", `https://instagram.com/p/${CODE}/`],
    ["no scheme", `instagram.com/p/${CODE}/`],
    ["no scheme with www", `www.instagram.com/p/${CODE}`],
    ["http scheme", `http://www.instagram.com/p/${CODE}/`],
    ["mobile host", `https://m.instagram.com/p/${CODE}/`],
    ["/reel/", `https://www.instagram.com/reel/${CODE}/`],
    ["/reels/", `https://www.instagram.com/reels/${CODE}/`],
    ["/tv/", `https://www.instagram.com/tv/${CODE}/`],
    ["query params", `https://www.instagram.com/p/${CODE}/?utm_source=ig_web_copy_link&igsh=MWx2`],
    ["reel with igsh", `https://www.instagram.com/reel/${CODE}/?igsh=abc123==`],
    ["hash fragment", `https://www.instagram.com/p/${CODE}/#comments`],
    ["username prefix /p/", `https://www.instagram.com/natgeo/p/${CODE}/`],
    ["username prefix /reel/", `https://www.instagram.com/some.user_99/reel/${CODE}/`],
    ["surrounding whitespace", `   https://www.instagram.com/p/${CODE}/  `],
    ["uppercase host", `https://WWW.INSTAGRAM.COM/p/${CODE}/`],
    ["trailing sub-path", `https://www.instagram.com/p/${CODE}/liked_by/`],
    ["shortcode with - and _", "https://www.instagram.com/p/Ab-_Cd12EfG/"],
  ];

  it.each(accepted)("%s", (_label, input) => {
    const result = parseInstagramUrl(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (input.includes("Ab-_Cd12EfG")) {
      expect(result.shortcode).toBe("Ab-_Cd12EfG");
    } else {
      expect(result.shortcode).toBe(CODE);
      expect(result.canonicalUrl).toBe(CANONICAL);
    }
  });

  it("preserves shortcode case (codes are case-sensitive)", () => {
    const result = parseInstagramUrl("https://www.instagram.com/p/AbCdEfGhIjK/");
    expect(result).toEqual({
      ok: true,
      shortcode: "AbCdEfGhIjK",
      canonicalUrl: "https://www.instagram.com/p/AbCdEfGhIjK/",
    });
  });
});

describe("parseInstagramUrl — rejected", () => {
  const rejected: Array<[string, string, RegExp]> = [
    ["empty string", "", /paste an instagram/i],
    ["whitespace only", "   ", /paste an instagram/i],
    ["garbage", "not a url at all", /doesn't look like a url|only instagram/i],
    ["non-instagram domain", `https://www.tiktok.com/p/${CODE}/`, /only instagram\.com/i],
    ["lookalike domain", `https://instagram.com.evil.io/p/${CODE}/`, /only instagram\.com/i],
    ["ftp scheme", `ftp://instagram.com/p/${CODE}/`, /doesn't look like a url/i],
    ["story", "https://www.instagram.com/stories/natgeo/3312345678901234567/", /stories/i],
    ["stories highlights", "https://www.instagram.com/stories/highlights/17900000000000000/", /stories/i],
    ["profile", "https://www.instagram.com/natgeo/", /profile/i],
    ["profile without slash", "https://instagram.com/natgeo", /profile/i],
    ["profile reels tab", "https://www.instagram.com/natgeo/reels/", /profile/i],
    ["audio page", "https://www.instagram.com/reels/audio/1234567890123456/", /audio/i],
    ["share link", "https://www.instagram.com/share/BAabc123xyz", /open the link/i],
    ["share reel link", "https://www.instagram.com/share/reel/BAabc123xyz/", /open the link/i],
    ["homepage", "https://www.instagram.com/", /isn't a post/i],
    ["reels feed", "https://www.instagram.com/reels/", /isn't a post/i],
    ["explore", "https://www.instagram.com/explore/tags/travel/", /isn't a post/i],
    ["too-short shortcode", "https://www.instagram.com/p/ab/", /doesn't look valid/i],
    ["invalid shortcode chars", "https://www.instagram.com/p/abc%24%24def/", /doesn't look valid/i],
  ];

  it.each(rejected)("%s", (_label, input, message) => {
    const result = parseInstagramUrl(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(message);
  });
});
