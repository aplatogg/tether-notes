import { describe, expect, test } from "vitest";
import { readSupabaseConfig } from "./config";

describe("readSupabaseConfig", () => {
  test("returns null unless both public browser values are present", () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(
      readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://notes.supabase.co" }),
    ).toBeNull();
    expect(
      readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key" }),
    ).toBeNull();
  });

  test("returns trimmed public configuration without reading service-role values", () => {
    expect(
      readSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "  https://notes.supabase.co  ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "  anon-key  ",
        SUPABASE_SERVICE_ROLE_KEY: "must-not-be-used",
      }),
    ).toEqual({
      url: "https://notes.supabase.co",
      anonKey: "anon-key",
    });
  });
});
