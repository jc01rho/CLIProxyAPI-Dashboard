const REST_BASE = '/rest/v1'

function formatFilterValue(operator, value) {
  if (operator === 'in') {
    const values = Array.isArray(value) ? value : [value]
    return `(${values.map((item) => {
      if (typeof item === 'number') return item
      return `"${String(item).replace(/"/g, '\\"')}"`
    }).join(',')})`
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

async function request(table, { select = '*', filters = [], order, limit } = {}) {
  const url = new URL(`${REST_BASE}/${table}`, window.location.origin)
  url.searchParams.set('select', select)

  for (const filter of filters) {
    const { column, operator, value } = filter
    url.searchParams.append(column, `${operator}.${formatFilterValue(operator, value)}`)
  }

  if (order?.column) {
    url.searchParams.set('order', `${order.column}.${order.ascending === false ? 'desc' : 'asc'}`)
  }

  if (typeof limit === 'number') {
    url.searchParams.set('limit', String(limit))
  }

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const error = new Error(payload?.message || `PostgREST request failed: ${response.status}`)
    if (payload && typeof payload === 'object') {
      Object.assign(error, payload)
    }
    error.status = response.status
    throw error
  }

  return Array.isArray(payload) ? payload : (payload ? [payload] : [])
}

export async function selectRows(table, options) {
  return request(table, options)
}

export async function selectSingle(table, options) {
  const rows = await request(table, { ...options, limit: 1 })
  return rows[0] ?? null
}
