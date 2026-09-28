import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapV1Media, mapV2Media } from "@/lib/metrics/mapper";

const FIXTURES = path.join(__dirname, "fixtures");

type Raw = Record<string, unknown>;

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

function v2Item(name: string): Raw {
  const body = load(name) as { items: Raw[] };
  return body.items[0]!;
}

describe("mapV2Media", () => {
  it("maps a reel", () => {
    expect(mapV2Media(v2Item("v2-reel.json"))).toEqual({
      shortcode: "C9ReelAbc12",
      media_pk: "3412345678901234567",
      owner_username: "natgeo",
      owner_pk: "25025320",
      media_type: 2,
      product_type: "clips",
      caption: "Sunrise over the Serengeti 🌅",
      taken_at: "2024-07-01T10:40:00.000Z",
      like_count: 184233,
      comment_count: 1532,
      play_count: 4821345, // play_count wins over view_count
      ig_play_count: 4102211,
      fb_play_count: 719134,
      reshare_count: 9120,
      save_count: null,
      likes_hidden: false,
      shares_disabled: false,
    });
  });

  it("maps a photo: no views, real zero comments stays 0", () => {
    const m = mapV2Media(v2Item("v2-photo.json"));
    expect(m.media_type).toBe(1);
    expect(m.product_type).toBe("feed");
    expect(m.comment_count).toBe(0);
    expect(m.play_count).toBeNull();
    expect(m.ig_play_count).toBeNull();
    expect(m.fb_play_count).toBeNull();
    expect(m.reshare_count).toBe(3);
    expect(m.shares_disabled).toBe(false);
    expect(m.save_count).toBeNull();
  });

  it("maps a carousel with a null caption", () => {
    const m = mapV2Media(v2Item("v2-carousel.json"));
    expect(m.media_type).toBe(8);
    expect(m.product_type).toBe("carousel_container");
    expect(m.caption).toBeNull();
    expect(m.like_count).toBe(12045);
    expect(m.play_count).toBeNull();
    expect(m.media_pk).toBe("3387654321098765432");
  });

  it("hidden likes + missing reshare_count → nulls, not zeros", () => {
    const m = mapV2Media(v2Item("v2-hidden-likes.json"));
    expect(m.likes_hidden).toBe(true);
    expect(m.shares_disabled).toBe(true);
    expect(m.like_count).toBeNull();
    expect(m.reshare_count).toBeNull();
    expect(m.ig_play_count).toBeNull();
    expect(m.fb_play_count).toBeNull();
    expect(m.save_count).toBeNull();
    expect(m.comment_count).toBe(44);
    expect(m.play_count).toBe(91000);
  });

  it("falls back to view_count when play_count is absent", () => {
    expect(mapV2Media({ view_count: 77 }).play_count).toBe(77);
  });

  it("keeps a real 0 play_count instead of falling through to view_count", () => {
    expect(mapV2Media({ play_count: 0, view_count: 55 }).play_count).toBe(0);
  });

  it("returns all-null metrics for an empty object without throwing", () => {
    const m = mapV2Media({});
    for (const key of [
      "shortcode",
      "media_pk",
      "owner_username",
      "owner_pk",
      "media_type",
      "product_type",
      "caption",
      "taken_at",
      "like_count",
      "comment_count",
      "play_count",
      "ig_play_count",
      "fb_play_count",
      "reshare_count",
      "save_count",
    ] as const) {
      expect(m[key], key).toBeNull();
    }
    expect(m.likes_hidden).toBe(false);
    expect(m.shares_disabled).toBe(false);
  });

  it("rejects negative / non-numeric counts as null", () => {
    const m = mapV2Media({ like_count: -1, comment_count: "abc", reshare_count: "12" });
    expect(m.like_count).toBeNull();
    expect(m.comment_count).toBeNull();
    expect(m.reshare_count).toBe(12);
  });

  it("never converts an unsafe numeric pk (would be lossy)", () => {
    expect(mapV2Media({ pk: 3412345678901234567 }).media_pk).toBeNull();
    expect(mapV2Media({ pk: 12345 }).media_pk).toBe("12345");
  });

  it("ignores save-like fields — saves are never derived", () => {
    expect(mapV2Media({ save_count: 10, saved_count: 10 } as Raw).save_count).toBeNull();
  });
});

describe("mapV1Media", () => {
  it("maps an ad post with v1 field names", () => {
    expect(mapV1Media(load("v1-ad.json") as Raw)).toEqual({
      shortcode: "C6AdPost123",
      media_pk: "3376543210987654321",
      owner_username: "brand.official",
      owner_pk: "998877",
      media_type: 2,
      product_type: "ad",
      caption: "Shop the new collection",
      taken_at: "2024-05-01T12:00:00.000Z",
      like_count: 5210,
      comment_count: 97,
      play_count: 250000,
      ig_play_count: null,
      fb_play_count: null,
      reshare_count: null,
      save_count: null,
      likes_hidden: false,
      shares_disabled: false,
    });
  });

  it("also accepts the v2 shape", () => {
    const fromV1 = mapV1Media(v2Item("v2-reel.json"));
    const fromV2 = mapV2Media(v2Item("v2-reel.json"));
    expect(fromV1).toEqual(fromV2);
  });
});

// Real payloads captured with `npx tsx scripts/probe.ts <url>` are checked for basic invariants.
const realFixtures = readdirSync(FIXTURES).filter((f) => f.startsWith("real-") && f.endsWith(".json"));

describe.skipIf(realFixtures.length === 0)("real HikerAPI fixtures", () => {
  it.each(realFixtures)("%s maps without zero-filling", (file) => {
    const body = load(file) as Raw;
    const isV2 = Array.isArray(body.items);
    const raw = isV2 ? (body.items as Raw[])[0]! : body;
    const m = isV2 ? mapV2Media(raw) : mapV1Media(raw);
    expect(m.shortcode).toBeTruthy();
    expect(m.media_pk).toMatch(/^\d+$/);
    expect(m.save_count).toBeNull();
    for (const key of ["like_count", "comment_count", "reshare_count", "play_count"] as const) {
      if (raw[key] === undefined && !(key === "play_count" && raw.view_count !== undefined)) {
        expect(m[key], key).toBeNull();
      }
    }
  });
});
