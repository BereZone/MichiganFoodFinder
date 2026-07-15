import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Auth/favorites are optional: without these build-time env vars the site
// runs exactly as before (localStorage favorites, no sign-in button).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
    url && anonKey ? createClient(url, anonKey) : null;
