import { createClient } from '@supabase/supabase-js'

// PostgREST is proxied at /rest/v1/ by nginx (same origin as the dashboard)
// No env vars needed — works automatically in both Docker and local nginx setups
const supabaseUrl = window.location.origin
const supabaseKey = 'anon'  // PostgREST uses web_anon role (no JWT required)

export const supabase = createClient(supabaseUrl, supabaseKey)
