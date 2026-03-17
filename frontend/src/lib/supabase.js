import { createClient } from '@supabase/supabase-js'

// PostgREST is proxied at /rest/v1/ by nginx (same origin as the dashboard)
// No env vars needed — works automatically in both Docker and local nginx setups
const supabaseUrl = window.location.origin
const supabaseKey = 'anon'  // PostgREST uses web_anon role (no JWT required)

const authenticatedFetch = async (input, init = {}) => {
    const response = await fetch(input, {
        ...init,
        credentials: 'include',
    })

    if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cliproxy:auth-unauthorized'))
    }

    return response
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
        fetch: authenticatedFetch,
    },
})
