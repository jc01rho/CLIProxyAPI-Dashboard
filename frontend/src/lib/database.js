import { selectRows as selectPostgrestRows, selectSingle as selectPostgrestSingle } from './postgrest'
import { selectRows as selectSupabaseRows, selectSingle as selectSupabaseSingle } from './supabase'
import { isSupabaseMode } from './runtimeConfig'

export async function selectRows(table, options) {
  if (isSupabaseMode()) {
    return selectSupabaseRows(table, options)
  }

  return selectPostgrestRows(table, options)
}

export async function selectSingle(table, options) {
  if (isSupabaseMode()) {
    return selectSupabaseSingle(table, options)
  }

  return selectPostgrestSingle(table, options)
}
