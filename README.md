# Post Metrics

Paste an Instagram post or reel URL and get its public metrics (views, likes, comments, shares), fetched through [HikerAPI](https://hikerapi.com). Every fetch is stored as a snapshot, so you can see how a post grows over time.

Stack: Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS · Supabase Postgres · Zod · Recharts · Vitest. Deploy target: Vercel.

---

## Setup

Requirements: Node 22+ (the JSON parser relies on `JSON.parse` source-text access, which needs Node 21+), a Supabase project, and a HikerAPI key.

```bash
npm install
cp .env.example .env.local   # then fill it in (see below)
# run the migration (see "Database")
npm run dev                  # http://localhost:3000
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `HIKER_API_KEY` | yes | HikerAPI access key. Sent as the `x-access-key` header. |
| `SUPABASE_URL` | yes | Project URL, e.g. `https://abcd.supabase.co`. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key (Project Settings → API). Bypasses RLS. |
| `CACHE_TTL_MINUTES` | no (default `30`) | How long a snapshot is reused before `/api/scrape` calls HikerAPI again. |

All four are **server-only**. Never prefix them with `NEXT_PUBLIC_`. The modules that read them (`lib/env.ts`, `lib/db/*`, `lib/hiker/server.ts`) import `server-only`, so the build fails if client code ever imports them. On Vercel, add them under Project → Settings → Environment Variables.

### Database

The schema lives in `supabase/migrations/`. Run the files **in order**: [001_init.sql](supabase/migrations/001_init.sql), then [002_repost_count.sql](supabase/migrations/002_repost_count.sql). Apply them with either:

- **Supabase dashboard:** SQL Editor → New query → paste one file → Run. Repeat for the next file.
- **Supabase CLI:** `supabase link --project-ref <ref>` then `supabase db push`.

It creates:

- `posts`: one row per shortcode (metadata).
- `post_metric_snapshots`: one row per fetch, with the normalized metrics and the full `raw_json`.
- `hiker_api_calls`: a log of every HikerAPI HTTP attempt (endpoint, status, duration, error). Use it to track spend.
- `post_latest_metrics`: a view joining each post to its newest snapshot. It backs sorting and pagination in `GET /api/posts`.

RLS is enabled on every table with **no policies**, so the anon and authenticated roles can read nothing. The view is `security_invoker`, so it obeys the same RLS. The server uses the service role key, which bypasses RLS.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (includes the type check) |
| `npm run test` | Vitest unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npx tsx scripts/probe.ts <url> [--v1]` | Capture a real HikerAPI payload (see below) |

### Capturing real payloads (`scripts/probe.ts`)

The test fixtures in `tests/fixtures/` are hand-written, realistic but minimal shapes. To check the mapper against real data:

```bash
npx tsx scripts/probe.ts https://www.instagram.com/reel/<code>/
npx tsx scripts/probe.ts https://www.instagram.com/p/<code>/ --v1   # force the v1 endpoint
```

The script calls v2 (falling back to v1 on 404) and writes the response body to `tests/fixtures/real-<shortcode>.json`. It then prints the mapped metrics and the media object's top-level keys. It reads `HIKER_API_KEY` from `.env.local`, doesn't touch the database, and costs one or two HikerAPI requests.

`npm run test` picks up any `real-*.json` automatically and checks basic invariants: a shortcode, a string `media_pk`, and no zero-filled missing fields. Compare the printed values against the post in the Instagram app, then resolve the `TODO(verify with probe)` comments.

---

## API

All errors use one shape:

```json
{ "error": { "code": "INVALID_URL", "message": "Stories aren't supported. Paste a link to a post or reel instead." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_URL` | 400 | Bad URL or request input (includes HikerAPI v2 returning 400) |
| `POST_NOT_FOUND` | 404 | Both v2 and v1 returned 404: the post is deleted, private, or restricted. Also returned by `GET /api/posts/[shortcode]` for an untracked post. |
| `PRIVATE_OR_UNAVAILABLE` | 404 | HikerAPI returned 403 |
| `RATE_LIMITED` | 429 | Our per-IP limit (20/min on `/api/scrape`, with a `Retry-After` header), or HikerAPI still returning 429 after one retry |
| `UPSTREAM_ERROR` | 502 / 500 | HikerAPI 5xx/timeout, 401 (invalid `HIKER_API_KEY`), or 402 (HikerAPI balance empty) (502), or an unexpected server/database error (500) |

### `POST /api/scrape`

Fetches the post's metrics and stores a snapshot.

Request:

```json
{ "url": "https://www.instagram.com/reel/C8xYz12AbCd/?igsh=abc", "force": false }
```

Flow:
1. Validate the body and parse the URL into a shortcode.
2. Unless `force` is true, if the newest snapshot is younger than `CACHE_TTL_MINUTES`, return it with no HikerAPI call.
3. Call HikerAPI v2 `/v2/media/info/by/url`, falling back to v1 `/v1/media/by/url` on 404.
4. Map the response, upsert the post, insert the snapshot, and set `last_fetched_at`.

Response `200`:

```json
{
  "post": {
    "id": "uuid", "shortcode": "C8xYz12AbCd", "media_pk": "3412345678901234567",
    "owner_username": "natgeo", "owner_pk": "25025320", "media_type": 2, "product_type": "clips",
    "caption": "…", "taken_at": "2024-07-01T10:40:00+00:00",
    "first_seen_at": "…", "last_fetched_at": "…"
  },
  "snapshot": {
    "id": "uuid", "post_id": "uuid", "fetched_at": "…", "source_endpoint": "v2_by_url",
    "like_count": 184233, "comment_count": 1532, "play_count": 4821345,
    "ig_play_count": 4102211, "fb_play_count": 719134, "reshare_count": 9120,
    "repost_count": 412, "save_count": 15210, "likes_hidden": false, "shares_disabled": false
  },
  "cached": false
}
```

`raw_json` is stored in the database but left out of API responses.

### `GET /api/posts`

Lists tracked posts, each with its latest snapshot.

| Query param | Default | Values |
|---|---|---|
| `limit` | `25` | 1–100 |
| `offset` | `0` | ≥ 0 |
| `sort` | `recent` | `recent` (last fetched), `views`, `likes` |
| `direction` | `desc` | `asc`, `desc` |

Nulls always sort last. Response: `{ items: PostWithLatest[], total, limit, offset }`. Each item has the post columns plus `snapshot_id`, `fetched_at`, `source_endpoint`, and the metric columns.

### `GET /api/posts/[shortcode]`

Returns `{ post, snapshots }`, with snapshots newest first (capped at 500). Returns `404 POST_NOT_FOUND` if the post isn't tracked.

---

## Metric availability

**Rule: a missing value is stored as `null`, never `0`.** `0` means a real zero. The UI shows `—` for nulls, with a tooltip that explains why.

| Metric | Source field | Availability |
|---|---|---|
| Views | `play_count`, else `view_count` | Reels and videos. `null` for photos and most carousels, and when the creator hides counts. |
| IG / FB views | `ig_play_count` / `fb_play_count` | Reels only, and not always present |
| Likes | `like_count` | Public unless the creator hid like counts (`like_and_view_counts_disabled`) |
| Comments | `comment_count` | Public |
| Shares | `reshare_count` | v2 only. `null` when the creator disabled share counts (`share_count_disabled`). |
| Reposts | `media_repost_count` | v2 only, and only for some posts (absent on a Jul 2025 reel; reposts launched Aug 2025) |
| Saves | `save_count` | v2 only, and Instagram omits it for some posts. Stored exactly as returned, never estimated or derived. |

### v2 vs the v1 fallback

The two endpoints return very different payloads, both verified against real responses:

- **v2** (`/v2/media/info/by/url`) returns `{ media_or_ad: { ...media }, status: "ok" }`, not the `{ items: [...] }` shape in HikerAPI's docs; the code accepts both. It carries every metric above.
- **v1** (`/v1/media/by/url`) returns the bare media object with only likes, comments and plays. It has no shares, reposts, saves or IG/FB split. It also uses `caption_text` and an ISO `taken_at`, and sends `view_count: 0` next to a real `play_count`, so the mapper treats that 0 as unknown.

The app only uses v1 when v2 returns 404 (or a 200 without a media object). A snapshot's `source_endpoint` records which one it came from, and the UI tooltips say when a `—` is because of the v1 fallback.

### Engagement rate

Shown only when views are known and non-zero: `(likes + comments + shares) / views`. Null components are skipped, and the UI states which components were included, e.g. `(comments) / views · excludes likes, shares`.

---

## Known limitations

- **Rate limiting is in-memory.** The 20/min per-IP limit on `/api/scrape` lives in the serverless instance's memory. On Vercel it's per instance and resets on cold starts. Move it to Upstash Redis (or similar) before real traffic.
- **The cache is time-based only.** Every new snapshot is one HikerAPI request (two if it falls back to v1). `Force refresh` and the detail page's "Fetch new snapshot" skip the cache.
- **Snapshots only exist when someone fetches.** There are no scheduled refreshes yet, so history is only as dense as manual fetches.
- **Share links (`instagram.com/share/...`) are rejected.** Resolving them would need a server-side redirect follow, which Instagram often blocks. Users are asked to paste the final URL.
- **Private posts can't be fetched.** How HikerAPI signals private versus deleted posts isn't confirmed yet (see TODOs). Both currently surface as 404s.
- **v1 fallback snapshots are sparse.** They have no shares, reposts, saves or IG/FB split (see above).
- **Posts are keyed by the shortcode from the user's URL.** If Instagram ever returns a different `code` for the same media (e.g. a private-share code), they'd be stored as two posts.
- **Post metadata upserts skip nulls.** A later response missing a field (e.g. a v1 fallback with no caption) won't wipe a stored value. This also means a caption the creator deleted stays stored.
- **No auth.** Anyone who can reach the deployment can trigger HikerAPI calls, limited only by the per-IP rate limit.

### Open `TODO(verify with probe)` items

- [lib/hiker/media.ts](lib/hiker/media.ts): what HikerAPI returns for private or age-restricted posts (currently 403 is assumed → `PRIVATE_OR_UNAVAILABLE`).

---

## Next steps (out of scope for this phase)

- **Auth:** gate `/api/scrape` behind accounts (e.g. Supabase Auth) and track posts per user.
- **Scheduled refreshes:** a cron job (Vercel Cron or Supabase `pg_cron`) that re-snapshots tracked posts, with a per-post cadence and HikerAPI budget controls.
- **Shared rate limiting:** Upstash Redis instead of in-memory.
- **Payments / quotas:** meter HikerAPI usage per user, using `hiker_api_calls`.

---

## Project layout

```
app/
  page.tsx                      Fetch form + metrics card
  posts/page.tsx                Tracked posts table (sortable, paginated)
  posts/[shortcode]/page.tsx    Detail: latest metrics, charts, snapshot history
  api/scrape/route.ts           POST: fetch + store a snapshot
  api/posts/route.ts            GET: list posts with latest snapshot
  api/posts/[shortcode]/route.ts GET: post + all snapshots
components/                     MetricsCard, MetricChart, PostDetail, shared UI bits
lib/
  instagram/parseUrl.ts         URL → shortcode + canonical URL
  hiker/client.ts               fetch wrapper: auth header, 20s timeout, 1 retry on 429/5xx, call logging
  hiker/media.ts                getMediaByUrl: v2 → v1 fallback, status → error code
  hiker/server.ts               client wired to env + DB logger (server-only)
  metrics/mapper.ts             mapV2Media / mapV1Media → NormalizedMetrics
  metrics/engagement.ts         engagement rate
  db/                           Supabase client, typed schema, queries
  rateLimit.ts                  in-memory per-IP limiter
scripts/probe.ts                capture real payloads
supabase/migrations/            001_init.sql, 002_repost_count.sql
tests/                          Vitest specs + fixtures
```
