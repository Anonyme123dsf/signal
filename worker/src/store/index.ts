import type { Config } from "../config.ts";
import { MemoryStore } from "./memory.ts";
import { SupabaseStore } from "./supabase.ts";
import type { Store } from "./types.ts";

export function createStore(cfg: Config): Store {
  return cfg.store === "memory" ? new MemoryStore() : new SupabaseStore(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
}
