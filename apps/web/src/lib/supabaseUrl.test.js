import { describe, it, expect } from 'vitest';
import { normalizeSupabaseUrl } from './supabaseUrl';

describe('normalizeSupabaseUrl', () => {
  it('keeps a good URL (without a trailing path)', () => {
    expect(normalizeSupabaseUrl('https://abc.supabase.co')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl('https://abc.supabase.co/')).toBe('https://abc.supabase.co');
  });

  it('repairs the usual dashboard mistakes: spaces, quotes, missing scheme', () => {
    expect(normalizeSupabaseUrl('  "https://abc.supabase.co"  ')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl("'abc.supabase.co'")).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl('abc.supabase.co')).toBe('https://abc.supabase.co');
  });

  it('never throws: an unusable value becomes the placeholder, so the site still starts (demo mode needs no Supabase)', () => {
    expect(normalizeSupabaseUrl(undefined)).toBe('http://localhost:54321');
    expect(normalizeSupabaseUrl('')).toBe('http://localhost:54321');
    expect(normalizeSupabaseUrl('not a url at all %%%')).toBe('http://localhost:54321');
  });
});
