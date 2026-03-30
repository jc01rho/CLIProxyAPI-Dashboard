import { createClient } from '@supabase/supabase-js'
import { assertSupabaseConfig, supabasePublishableKey, supabaseUrl } from './runtimeConfig'

let client

function getSupabaseClient() {
  if (!client) {
    assertSupabaseConfig()
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }

  return client
}

function applyFilters(query, filters = []) {
  return filters.reduce((builder, filter) => {
    const { column, operator, value } = filter

    switch (operator) {
      case 'eq':
        return builder.eq(column, value)
      case 'gte':
        return builder.gte(column, value)
      case 'lt':
        return builder.lt(column, value)
      case 'in': {
        const values = Array.isArray(value) ? value : [value]
        return builder.in(column, values)
      }
      default:
        throw new Error(`Unsupported Supabase filter operator: ${operator}`)
    }
  }, query)
}

async function request(table, { select = '*', filters = [], order, limit } = {}) {
  let query = getSupabaseClient().from(table).select(select)
  query = applyFilters(query, filters)

  if (order?.column) {
    query = query.order(order.column, { ascending: order.ascending !== false })
  }

  if (typeof limit === 'number') {
    query = query.limit(limit)
  }

  const { data, error } = await query
  if (error) {
    throw error
  }

  return Array.isArray(data) ? data : (data ? [data] : [])
}

export async function selectRows(table, options) {
  return request(table, options)
}

export async function selectSingle(table, options) {
  const rows = await request(table, { ...options, limit: 1 })
  return rows[0] ?? null
}
