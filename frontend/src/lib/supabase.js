import { createClient } from '@supabase/supabase-js'

// Runtime environment configuration
// These placeholders are replaced at container startup by docker-entrypoint.sh
// Falls back to build-time env vars for local development
const getEnvValue = (placeholder, buildTimeValue) => {
    // If placeholder wasn't replaced (still contains PLACEHOLDER), use build-time value
    if (placeholder && !placeholder.includes('PLACEHOLDER')) {
        return placeholder
    }
    return buildTimeValue
}

const supabaseUrl = getEnvValue(
    '__SUPABASE_URL_PLACEHOLDER__',
    import.meta.env.SUPABASE_URL
)
const supabasePublishableKey = getEnvValue(
    '__SUPABASE_PUBLISHABLE_KEY_PLACEHOLDER__',
    import.meta.env.SUPABASE_PUBLISHABLE_KEY
)

console.log('🔍 Supabase Environment Check:')
console.log('  URL:', supabaseUrl ? '✓ Found' : '✗ Missing')
console.log('  Key:', supabasePublishableKey ? '✓ Found' : '✗ Missing')

if (!supabaseUrl || !supabasePublishableKey) {
    console.error('❌ Missing Supabase environment variables')
    console.log('Expected vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY')
    console.log('Available env vars:', Object.keys(import.meta.env))
}

export const supabase = createClient(supabaseUrl || '', supabasePublishableKey || '')
