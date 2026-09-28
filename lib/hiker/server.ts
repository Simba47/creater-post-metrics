import "server-only";
import { logHikerCall } from "@/lib/db/apiCalls";
import { getEnv } from "@/lib/env";
import { createHikerClient, type HikerClient } from "./client";

let client: HikerClient | undefined;

/** HikerAPI client wired to the server env and the hiker_api_calls log table. */
export function getHikerClient(): HikerClient {
  client ??= createHikerClient({ apiKey: getEnv().HIKER_API_KEY, logCall: logHikerCall });
  return client;
}
