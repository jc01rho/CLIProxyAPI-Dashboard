const readWindowConfig = () => {
  if (typeof window === 'undefined') return {}
  const runtime = window.__APP_CONFIG__
  return runtime && typeof runtime === 'object' ? runtime : {}
}

const runtimeConfig = readWindowConfig()

function readEnvValue(key, fallback = '') {
  const runtimeValue = runtimeConfig[key]
  if (runtimeValue !== undefined && runtimeValue !== null && runtimeValue !== '') {
    return runtimeValue
  }

  const env = import.meta.env?.[key]
  if (env !== undefined && env !== null && env !== '') {
    return env
  }

  return fallback
}

export const databaseProvider = String(readEnvValue('VITE_DATABASE_PROVIDER', readEnvValue('DATABASE_PROVIDER', 'local'))).trim().toLowerCase() || 'local'
export const supabaseUrl = readEnvValue('VITE_SUPABASE_URL', readEnvValue('SUPABASE_URL', ''))
export const supabasePublishableKey = readEnvValue('VITE_SUPABASE_PUBLISHABLE_KEY', readEnvValue('SUPABASE_PUBLISHABLE_KEY', ''))

export function isSupabaseMode() {
  return databaseProvider === 'supabase'
}

export function assertSupabaseConfig() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase mode requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
  }
}
