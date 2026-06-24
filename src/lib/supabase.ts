import { browser } from "#imports";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://pdixkzhncuuxuxwhdwdh.supabase.co";

// Public anon key. It is safe to ship: every table is protected by row level
// security, so this key alone grants no access to anyone's data.
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkaXhremhuY3V1eHV4d2hkd2RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzA2MjIsImV4cCI6MjA5Nzg0NjYyMn0.FfDMzEV6W5_IVuVmm_ld1zUx9wjrTE6Vuj415wHSAas";

// supabase-js defaults to localStorage, which does not exist in a service
// worker. Back the session in browser.storage.local so it survives worker
// restarts.
const storageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const res = await browser.storage.local.get(key);
    return (res[key] as string | undefined) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await browser.storage.local.set({ [key]: value });
  },
  removeItem: async (key: string): Promise<void> => {
    await browser.storage.local.remove(key);
  },
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: storageAdapter,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
