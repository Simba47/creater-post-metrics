import "server-only";
import { z } from "zod";

const schema = z.object({
  HIKER_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CACHE_TTL_MINUTES: z.coerce.number().int().min(0).default(30),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** Read lazily so `next build` works without secrets present. */
export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const vars = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables: ${vars}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
