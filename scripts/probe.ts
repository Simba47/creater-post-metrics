/**
 * Capture a real HikerAPI payload as a test fixture.
 *
 *   npx tsx scripts/probe.ts <instagram-url> [--v1]
 *
 * Calls v2 by/url (falling back to v1 on 404, or v1 only with --v1) and writes the response body to
 * tests/fixtures/real-<shortcode>.json. v2 bodies keep their { media_or_ad, status } wrapper; v1
 * bodies are the bare media object. Big integers are kept as strings, exactly as the app sees them.
 * Does not touch the database. Reads HIKER_API_KEY from the environment or .env.local.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createHikerClient, type HikerResponse } from "../lib/hiker/client";
import { extractV2Media, V1_BY_URL, V2_BY_URL } from "../lib/hiker/media";
import { parseInstagramUrl } from "../lib/instagram/parseUrl";
import { mapV1Media, mapV2Media } from "../lib/metrics/mapper";

async function main() {
  const args = process.argv.slice(2);
  const forceV1 = args.includes("--v1");
  const input = args.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("Usage: npx tsx scripts/probe.ts <instagram-url> [--v1]");
    process.exit(1);
  }

  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Fine if the file doesn't exist and the key is already in the environment.
  }
  const apiKey = process.env.HIKER_API_KEY;
  if (!apiKey) {
    console.error("HIKER_API_KEY is not set (checked the environment and .env.local).");
    process.exit(1);
  }

  const parsed = parseInstagramUrl(input);
  if (!parsed.ok) {
    console.error(`Invalid URL: ${parsed.message}`);
    process.exit(1);
  }
  const { shortcode, canonicalUrl } = parsed;

  const client = createHikerClient({
    apiKey,
    logCall: (e) => console.log(`  ${e.endpoint} → ${e.httpStatus ?? "no response"} (${e.durationMs}ms)${e.error ? ` ${e.error}` : ""}`),
  });

  console.log(`Probing ${canonicalUrl}`);
  let res: HikerResponse | null = null;
  let source: "v2" | "v1" = "v2";

  if (!forceV1) {
    res = await client.get({ path: V2_BY_URL, params: { url: canonicalUrl, safe_int: "true" } });
  }
  if (forceV1 || res?.status === 404) {
    source = "v1";
    res = await client.get({ path: V1_BY_URL, params: { url: canonicalUrl } });
  }

  if (!res || res.status !== 200) {
    console.error(`\nHikerAPI returned HTTP ${res?.status}:`, JSON.stringify(res?.body, null, 2));
    process.exit(1);
  }

  const outPath = path.join(process.cwd(), "tests", "fixtures", `real-${shortcode}.json`);
  writeFileSync(outPath, JSON.stringify(res.body, null, 2) + "\n");
  console.log(`\nWrote ${source} response to ${path.relative(process.cwd(), outPath)}`);

  const body = res.body as Record<string, unknown>;
  const raw = source === "v2" ? (extractV2Media(body) ?? {}) : body;
  const mapped = source === "v2" ? mapV2Media(raw) : mapV1Media(raw);
  console.log("\nMapped metrics (check these against the post in the Instagram app):");
  console.table(mapped);

  const topLevelKeys = Object.keys(raw).sort();
  console.log(`\nMedia object has ${topLevelKeys.length} top-level keys:\n  ${topLevelKeys.join(", ")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
