import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.SUPABASE_URL
const supabasePublishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY

console.log('🔍 Supabase Environment Check:')
console.log('  URL:', supabaseUrl ? '✓ Found' : '✗ Missing')
console.log('  Key:', supabasePublishableKey ? '✓ Found' : '✗ Missing')

if (!supabaseUrl || !supabasePublishableKey) {
    console.error('❌ Missing Supabase environment variables')
    console.log('Expected vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY')
    console.log('Available env vars:', Object.keys(import.meta.env))
}

export const supabase = createClient(supabaseUrl || '', supabasePublishableKey || '')
