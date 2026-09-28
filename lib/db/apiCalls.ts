import "server-only";
import type { HikerCallLog } from "@/lib/hiker/client";
import { getSupabase } from "./supabase";

export async function logHikerCall(entry: HikerCallLog): Promise<void> {
  const { error } = await getSupabase().from("hiker_api_calls").insert({
    endpoint: entry.endpoint,
    shortcode: entry.shortcode,
    http_status: entry.httpStatus,
    duration_ms: entry.durationMs,
    error: entry.error,
  });
  if (error) throw new Error(`[db] logHikerCall failed: ${error.message}`);
}
