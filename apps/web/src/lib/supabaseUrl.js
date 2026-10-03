const PLACEHOLDER_URL = 'http://localhost:54321';

/**
 * A usable Supabase URL from whatever the build was given: trims spaces and quotes, adds https:// when the scheme is
 * missing. An unusable value falls back to a placeholder: createClient() throws on an invalid URL, which used to
 * blank the whole site at start-up, demo mode included (a bad VITE_SUPABASE_URL in Vercel did exactly that).
 */
export function normalizeSupabaseUrl(raw) {
  const cleaned = String(raw ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!cleaned) return PLACEHOLDER_URL;
  const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return PLACEHOLDER_URL;
  }
}

/** The one Supabase URL of this build: the client and the demo-mode mock handlers must agree on it. */
export const SUPABASE_URL = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
