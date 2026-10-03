import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './supabaseUrl';

const supabaseAnonKey = String(
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'fake-anon-key',
)
  .trim()
  .replace(/^["']+|["']+$/g, '');

export const supabase = createClient(SUPABASE_URL, supabaseAnonKey);
