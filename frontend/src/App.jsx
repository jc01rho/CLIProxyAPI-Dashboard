import { useState, useEffect, useCallback } from 'react'
import { selectRows, selectSingle } from './lib/postgrest'
import Dashboard from './components/Dashboard'
import Login from './components/Login'

// Auth context helper - returns auth header if token exists
const getAuthHeader = () => {
    const token = localStorage.getItem('auth_token')
    return token ? { 'Authorization': `Bearer ${token}` } : {}
}
const APP_LOGS_PAGE_SIZE = Number(import.meta.env.VITE_APP_LOGS_PAGE_SIZE || 500)
const FRONTEND_AUTO_REFRESH_MS = Math.max(1000, Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 60) * 1000)
// Helper to get date boundaries based on range ID
// Uses local timezone for date display, converts to UTC for timestamp queries
const getDateBoundaries = (rangeId, customRange) => {
    const now = new Date()

    // Get today's date in local timezone as YYYY-MM-DD (for daily_stats)
    const formatDate = (d) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    // Create Date at local midnight and convert to UTC ISO string
    const localMidnightToUTC = (d) => {
        const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
        return localMidnight.toISOString()  // Converts to UTC
    }

    const todayStr = formatDate(now)
    const todayUTC = localMidnightToUTC(now)

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = formatDate(yesterday)
    const yesterdayUTC = localMidnightToUTC(yesterday)

    const parseLocalDate = (value) => {
        if (!value) return null
        const [y, m, d] = value.split('-').map(Number)
        if (!y || !m || !d) return null
        return new Date(y, m - 1, d, 0, 0, 0)
    }

    switch (rangeId) {
        case 'today':
            return {
                startDate: todayStr,      // For daily_stats (YYYY-MM-DD)
                endDate: null,
                startTime: todayUTC,      // For model_usage/snapshots (UTC ISO)
                endTime: null
            }
        case 'yesterday':
            return {
                startDate: yesterdayStr,
                endDate: todayStr,        // exclusive
                startTime: yesterdayUTC,  // start of yesterday in UTC
                endTime: todayUTC         // start of today in UTC (exclusive)
            }
        case '7d': {
            const d7 = new Date(now)
            d7.setDate(d7.getDate() - 7)
            return {
                startDate: formatDate(d7),
                endDate: null,
                startTime: localMidnightToUTC(d7),
                endTime: null
            }
        }
        case '30d': {
            const d30 = new Date(now)
            d30.setDate(d30.getDate() - 30)
            return {
                startDate: formatDate(d30),
                endDate: null,
                startTime: localMidnightToUTC(d30),
                endTime: null
            }
        }
        case 'month': {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
            return {
                startDate: formatDate(monthStart),
                endDate: null,
                startTime: localMidnightToUTC(monthStart),
                endTime: null
            }
        }
        case 'quarter': {
            const qStartMonth = Math.floor(now.getMonth() / 3) * 3
            const quarterStart = new Date(now.getFullYear(), qStartMonth, 1)
            return {
                startDate: formatDate(quarterStart),
                endDate: null,
                startTime: localMidnightToUTC(quarterStart),
                endTime: null
            }
        }
        case 'year': {
            const yearStart = new Date(now.getFullYear(), 0, 1)
            return {
                startDate: formatDate(yearStart),
                endDate: null,
                startTime: localMidnightToUTC(yearStart),
                endTime: null
            }
        }
        case 'custom': {
            const start = parseLocalDate(customRange?.startDate)
            const end = parseLocalDate(customRange?.endDate)

            const endExclusive = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) : null

            return {
                startDate: start ? formatDate(start) : null,
                endDate: endExclusive ? formatDate(endExclusive) : null,
                startTime: start ? localMidnightToUTC(start) : null,
                endTime: endExclusive ? localMidnightToUTC(endExclusive) : null
            }
        }
        case 'all':
        default:
            return { startDate: null, endDate: null, startTime: null, endTime: null }
    }
}

function App() {
    const [stats, setStats] = useState(null)
    const [dailyStats, setDailyStats] = useState([])
    const [modelUsage, setModelUsage] = useState([])
    const [endpointUsage, setEndpointUsage] = useState([]) // NEW: granular usage for API Keys
    const [hourlyStats, setHourlyStats] = useState([]) // NEW: hourly breakdown
    const [skillRuns, setSkillRuns] = useState([])
    const [skillDailyStats, setSkillDailyStats] = useState([])
    const [appLogs, setAppLogs] = useState([])
    const [loading, setLoading] = useState(true) // Only for initial load
    const [isRefreshing, setIsRefreshing] = useState(false) // For date range changes
    const [lastUpdated, setLastUpdated] = useState(null)
    const [dateRange, setDateRange] = useState('today') // 'today', 'yesterday', '7d', '30d', 'year', 'custom'
    const [customRange, setCustomRange] = useState({ startDate: null, endDate: null })

    // Credential stats state
    const [credentialData, setCredentialData] = useState(null)
    const [credentialTimeSeries, setCredentialTimeSeries] = useState({ byDay: [], byHour: [], meta: {} })
    const [credentialLoading, setCredentialLoading] = useState(true)
    const [credentialSetupRequired, setCredentialSetupRequired] = useState(false)

    // Authentication state
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [authChecking, setAuthChecking] = useState(true)
    const [authEnabled, setAuthEnabled] = useState(true)

    // Check authentication status on mount
    useEffect(() => {
        const checkAuth = async () => {
            try {
                // Check if auth is enabled on server
                const statusRes = await fetch('/api/collector/auth/status')
                const statusData = await statusRes.json()
                
                if (!statusData.auth_enabled) {
                    // Auth disabled on server - allow access
                    setAuthEnabled(false)
                    setIsAuthenticated(true)
                    return
                }
                
                setAuthEnabled(true)
                
                // Check if we have a stored token
                const token = localStorage.getItem('auth_token')
                const expires = localStorage.getItem('auth_expires')
                
                if (!token) {
                    setIsAuthenticated(false)
                    return
                }
                
                // Check if token is expired
                if (expires && new Date(expires) < new Date()) {
                    localStorage.removeItem('auth_token')
                    localStorage.removeItem('auth_expires')
                    setIsAuthenticated(false)
                    return
                }
                
                // Verify token with server
                const verifyRes = await fetch('/api/collector/auth/verify', {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                
                if (verifyRes.ok) {
                    setIsAuthenticated(true)
                } else {
                    localStorage.removeItem('auth_token')
                    localStorage.removeItem('auth_expires')
                    setIsAuthenticated(false)
                }
            } catch (err) {
                console.error('Auth check failed:', err)
                // On error, assume auth disabled and allow access
                setIsAuthenticated(true)
            } finally {
                setAuthChecking(false)
            }
        }
        
        checkAuth()
    }, [])

    const handleLogin = (token) => {
        setIsAuthenticated(true)
    }

    const handleLogout = () => {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('auth_expires')
        setIsAuthenticated(false)
    }
    // Fetch credential stats filtered by date range
    const fetchCredentialStats = useCallback(async (rangeId = dateRange) => {
        try {
            setCredentialLoading(true)

            const { startDate, endDate } = getDateBoundaries(rangeId, customRange)

            // Try credential_daily_stats first (date-range aware)
            let useDailyStats = false
            let dailyRowsForSeries = []
            try {
                const dailyRows = await selectRows('credential_daily_stats', {
                    select: 'credentials,api_keys,total_credentials,total_api_keys,stat_date',
                    filters: [
                        ...(startDate ? [{ column: 'stat_date', operator: 'gte', value: startDate }] : []),
                        ...(endDate ? [{ column: 'stat_date', operator: 'lt', value: endDate }] : []),
                    ],
                })
                const dailyError = null

                if (!dailyError && dailyRows) {
                    dailyRowsForSeries = dailyRows
                }

                if (!dailyError && dailyRows && dailyRows.length > 0) {
                    useDailyStats = true

                    // Aggregate credentials across days
                    const credMap = {}  // keyed by "auth_index||source"
                    const akMap = {}    // keyed by "api_key_name"

                    const CRED_NUM = ['total_requests', 'success_count', 'failure_count',
                        'input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens', 'total_tokens']
                    const AK_NUM = ['total_requests', 'total_tokens', 'success_count', 'failure_count',
                        'input_tokens', 'output_tokens']
                    const MODEL_NUM_CRED = ['requests', 'success', 'failure',
                        'input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens', 'total_tokens']
                    const MODEL_NUM_AK = ['requests', 'tokens', 'success', 'failure']

                    for (const row of dailyRows) {
                        // Merge credentials
                        for (const c of (row.credentials || [])) {
                            const key = `${c.auth_index || ''}||${c.source || ''}`
                            if (!credMap[key]) {
                                credMap[key] = { ...c, models: { ...(c.models || {}) } }
                            } else {
                                const ex = credMap[key]
                                for (const f of CRED_NUM) {
                                    ex[f] = (ex[f] || 0) + (c[f] || 0)
                                }
                                // Merge models
                                for (const [mName, mData] of Object.entries(c.models || {})) {
                                    if (!ex.models[mName]) {
                                        ex.models[mName] = { ...mData }
                                    } else {
                                        for (const f of MODEL_NUM_CRED) {
                                            ex.models[mName][f] = (ex.models[mName][f] || 0) + (mData[f] || 0)
                                        }
                                    }
                                }
                                // Union api_keys
                                ex.api_keys = [...new Set([...(ex.api_keys || []), ...(c.api_keys || [])])].sort()
                                // Update metadata
                                for (const f of ['provider', 'email', 'label', 'status', 'account_type']) {
                                    if (c[f]) ex[f] = c[f]
                                }
                            }
                        }

                        // Merge API keys
                        for (const a of (row.api_keys || [])) {
                            const key = a.api_key_name || ''
                            if (!akMap[key]) {
                                akMap[key] = { ...a, models: { ...(a.models || {}) } }
                            } else {
                                const ex = akMap[key]
                                for (const f of AK_NUM) {
                                    ex[f] = (ex[f] || 0) + (a[f] || 0)
                                }
                                for (const [mName, mData] of Object.entries(a.models || {})) {
                                    if (!ex.models[mName]) {
                                        ex.models[mName] = { ...mData }
                                    } else {
                                        for (const f of MODEL_NUM_AK) {
                                            ex.models[mName][f] = (ex.models[mName][f] || 0) + (mData[f] || 0)
                                        }
                                    }
                                }
                                ex.credentials_used = [...new Set([...(ex.credentials_used || []), ...(a.credentials_used || [])])].sort()
                            }
                        }
                    }

                    // Recalculate success_rate for aggregated credentials
                    const inferProvider = (cred) => {
                        const rawProvider = (cred.provider || '').trim()
                        const normalizedRawProvider = rawProvider.toLowerCase()
                        if (rawProvider) {
                            if (['unknown', 'unkown', 'unknown provider', 'unkown provider', 'api key provider'].includes(normalizedRawProvider)) {
                            } else if (normalizedRawProvider === 'api-key provider') {
                                return 'api-key'
                            } else if (normalizedRawProvider === 'oauth provider') {
                                return 'oauth'
                            } else {
                                return rawProvider
                            }
                        }

                        const source = (cred.source || '').toLowerCase()
                        const email = (cred.email || '').toLowerCase()
                        const label = (cred.label || '').toLowerCase()
                        const haystack = `${source} ${email} ${label}`

                        const configMatch = source.match(/^config:([^\[\]\s]+)\[/)
                        if (configMatch) {
                            // Keep original provider name for all OpenAI-compatible providers
                            return configMatch[1]
                        }
                        if (configMatch) {
                            const provider = configMatch[1]
                            if (['z.ai', 'z-ai', 'zai'].includes(provider)) return 'openai'
                            if (['google', 'googleai'].includes(provider)) return 'gemini-api-key'
                            if (['anthropic', 'claude'].includes(provider)) return 'anthropic'
                            return provider
                        }
                        if (haystack.includes('gemini') || haystack.includes('googleapis')) return 'gemini-api-key'
                        if (haystack.includes('claude') || haystack.includes('anthropic') || haystack.includes('antigravity')) return 'anthropic'
                        if (haystack.includes('openai') || haystack.includes('chatgpt') || haystack.includes('gpt') || haystack.includes('codex')) return 'openai'
                        if (haystack.includes('qwen') || haystack.includes('alibaba')) return 'alibaba'
                        if (haystack.includes('deepseek')) return 'deepseek'
                        if (haystack.includes('grok') || haystack.includes('xai')) return 'xai'
                        if (haystack.includes('@')) return 'oauth'
                        if (source.includes('=') || source.length > 40) return 'api-key'
                        return 'unknown'
                    }

                    const aggregatedCreds = Object.values(credMap).map(c => ({
                        ...c,
                        provider: inferProvider(c),
                        success_rate: c.total_requests > 0
                            ? Math.round((c.success_count / c.total_requests) * 1000) / 10
                            : 0
                    })).sort((a, b) => b.total_requests - a.total_requests)

                    const aggregatedAKs = Object.values(akMap).map(a => ({
                        ...a,
                        success_rate: a.total_requests > 0
                            ? Math.round((a.success_count / a.total_requests) * 1000) / 10
                            : 0
                    })).sort((a, b) => b.total_requests - a.total_requests)

                    setCredentialData({
                        credentials: aggregatedCreds,
                        api_keys: aggregatedAKs,
                        total_credentials: aggregatedCreds.length,
                        total_api_keys: aggregatedAKs.length,
                    })
                    setCredentialSetupRequired(false)
                }
            } catch (dailyErr) {
                // credential_daily_stats table might not exist yet — fall through to summary
                console.debug('credential_daily_stats not available, falling back to summary:', dailyErr.message)
            }

            // Build API-key by-day series from credential_daily_stats + daily_stats.breakdown (cost)
            const dailyCostByDate = {}
            if (startDate || rangeId === 'all') {
                let dailyBreakdownQuery = supabase
                    .from('daily_stats')
                    .select('stat_date, breakdown')

                if (startDate) dailyBreakdownQuery = dailyBreakdownQuery.gte('stat_date', startDate)
                if (endDate) dailyBreakdownQuery = dailyBreakdownQuery.lt('stat_date', endDate)

                const { data: dailyBreakdownRows } = await dailyBreakdownQuery
                for (const row of (dailyBreakdownRows || [])) {
                    const endpoints = row?.breakdown?.endpoints || {}
                    const costMap = {}
                    for (const [apiKeyName, endpointData] of Object.entries(endpoints)) {
                        costMap[apiKeyName] = endpointData?.cost || 0
                    }
                    dailyCostByDate[row.stat_date] = costMap
                }
            }

            const apiKeyDailySeries = (dailyRowsForSeries || [])
                .map((row) => {
                    const dayCostMap = dailyCostByDate[row.stat_date] || {}
                    const keys = (row.api_keys || [])
                        .map((k) => ({
                            api_key_name: k.api_key_name || 'unknown',
                            total_requests: k.total_requests || 0,
                            total_tokens: k.total_tokens || 0,
                            success_count: k.success_count || 0,
                            failure_count: k.failure_count || 0,
                            estimated_cost_usd: dayCostMap[k.api_key_name || 'unknown'] || 0,
                            success_rate: (k.total_requests || 0) > 0
                                ? Math.round(((k.success_count || 0) / (k.total_requests || 0)) * 1000) / 10
                                : 0,
                        }))
                        .sort((a, b) => b.total_requests - a.total_requests)

                    return {
                        stat_date: row.stat_date,
                        total_requests: keys.reduce((sum, k) => sum + (k.total_requests || 0), 0),
                        total_tokens: keys.reduce((sum, k) => sum + (k.total_tokens || 0), 0),
                        total_cost: keys.reduce((sum, k) => sum + (k.estimated_cost_usd || 0), 0),
                        keys,
                    }
                })
                .sort((a, b) => (a.stat_date || '').localeCompare(b.stat_date || ''))

            // Build API-key by-hour series from usage_snapshots.raw_data (cumulative -> delta)
            const { startTime, endTime } = getDateBoundaries(rangeId, customRange)
            let snapshotsRawQuery = supabase
                .from('usage_snapshots')
                .select('id, collected_at, raw_data, model_usage(api_endpoint, estimated_cost_usd)')
                .order('collected_at', { ascending: true })

            if (startTime) snapshotsRawQuery = snapshotsRawQuery.gte('collected_at', startTime)
            if (endTime) snapshotsRawQuery = snapshotsRawQuery.lt('collected_at', endTime)

            const { data: snapshotsRawRows, error: snapshotsRawError } = await snapshotsRawQuery

            let baselineRaw = null
            if (startTime) {
                const { data: baselineRawRows } = await supabase
                    .from('usage_snapshots')
                    .select('id, collected_at, raw_data, model_usage(api_endpoint, estimated_cost_usd)')
                    .lt('collected_at', startTime)
                    .order('collected_at', { ascending: false })
                    .limit(1)
                baselineRaw = baselineRawRows?.[0] || null
            }

            const readCumulativeApis = (snap) => {
                const apis = snap?.raw_data?.usage?.apis || {}
                const out = {}
                for (const [apiKeyName, apiData] of Object.entries(apis)) {
                    const models = apiData?.models || {}
                    let req = 0
                    let succ = 0
                    let fail = 0
                    let inTok = 0
                    let outTok = 0
                    let totalTok = 0
                    for (const modelData of Object.values(models)) {
                        req += modelData?.total_requests || 0
                        succ += modelData?.success_count || 0
                        fail += modelData?.failure_count || 0
                        const mIn = modelData?.input_tokens || 0
                        const mOut = modelData?.output_tokens || 0
                        const mTok = modelData?.total_tokens || 0
                        inTok += mIn
                        outTok += mOut
                        totalTok += mTok || (mIn + mOut)
                    }
                    out[apiKeyName] = {
                        total_requests: req,
                        success_count: succ,
                        failure_count: fail,
                        input_tokens: inTok,
                        output_tokens: outTok,
                        total_tokens: totalTok,
                    }
                }
                return out
            }

            const readCumulativeCostByApi = (snap) => {
                const out = {}
                for (const row of (snap?.model_usage || [])) {
                    const key = row?.api_endpoint || 'unknown'
                    out[key] = (out[key] || 0) + (parseFloat(row?.estimated_cost_usd) || 0)
                }
                return out
            }

            const mergeHourEntry = (hourMap, hourKey, apiKeyName, delta) => {
                if (!hourMap[hourKey]) {
                    hourMap[hourKey] = { total_requests: 0, total_tokens: 0, total_cost: 0, keys: {} }
                }
                const hour = hourMap[hourKey]
                if (!hour.keys[apiKeyName]) {
                    hour.keys[apiKeyName] = {
                        api_key_name: apiKeyName,
                        total_requests: 0,
                        total_tokens: 0,
                        success_count: 0,
                        failure_count: 0,
                        input_tokens: 0,
                        output_tokens: 0,
                        estimated_cost_usd: 0,
                    }
                }
                const keyRow = hour.keys[apiKeyName]
                keyRow.total_requests += delta.total_requests
                keyRow.total_tokens += delta.total_tokens
                keyRow.success_count += delta.success_count
                keyRow.failure_count += delta.failure_count
                keyRow.input_tokens += delta.input_tokens
                keyRow.output_tokens += delta.output_tokens
                keyRow.estimated_cost_usd += delta.estimated_cost_usd
                hour.total_requests += delta.total_requests
                hour.total_tokens += delta.total_tokens
                hour.total_cost += delta.estimated_cost_usd
            }

            const hourMap = {}
            let prevRaw = baselineRaw
            if (snapshotsRawRows && snapshotsRawRows.length > 0) {
                for (const snap of snapshotsRawRows) {
                    const curr = readCumulativeApis(snap)
                    const currCost = readCumulativeCostByApi(snap)
                    if (prevRaw) {
                        const prev = readCumulativeApis(prevRaw)
                        const prevCost = readCumulativeCostByApi(prevRaw)
                        const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr), ...Object.keys(prevCost), ...Object.keys(currCost)])
                        const dt = new Date(snap.collected_at)
                        const hourBucket = `${dt.toLocaleDateString('en-CA')} ${dt.getHours().toString().padStart(2, '0')}:00`

                        for (const apiKeyName of allKeys) {
                            const p = prev[apiKeyName] || {
                                total_requests: 0,
                                total_tokens: 0,
                                success_count: 0,
                                failure_count: 0,
                                input_tokens: 0,
                                output_tokens: 0,
                            }
                            const c = curr[apiKeyName] || {
                                total_requests: 0,
                                total_tokens: 0,
                                success_count: 0,
                                failure_count: 0,
                                input_tokens: 0,
                                output_tokens: 0,
                            }

                            let delta = {
                                total_requests: c.total_requests - p.total_requests,
                                total_tokens: c.total_tokens - p.total_tokens,
                                success_count: c.success_count - p.success_count,
                                failure_count: c.failure_count - p.failure_count,
                                input_tokens: c.input_tokens - p.input_tokens,
                                output_tokens: c.output_tokens - p.output_tokens,
                                estimated_cost_usd: (currCost[apiKeyName] || 0) - (prevCost[apiKeyName] || 0),
                            }

                            if (delta.total_requests < 0 || delta.total_tokens < 0 || delta.success_count < 0 || delta.failure_count < 0 || delta.estimated_cost_usd < 0) {
                                delta = {
                                    total_requests: c.total_requests,
                                    total_tokens: c.total_tokens,
                                    success_count: c.success_count,
                                    failure_count: c.failure_count,
                                    input_tokens: c.input_tokens,
                                    output_tokens: c.output_tokens,
                                    estimated_cost_usd: currCost[apiKeyName] || 0,
                                }
                            }

                            delta.total_requests = Math.max(0, delta.total_requests)
                            delta.total_tokens = Math.max(0, delta.total_tokens)
                            delta.success_count = Math.max(0, delta.success_count)
                            delta.failure_count = Math.max(0, delta.failure_count)
                            delta.input_tokens = Math.max(0, delta.input_tokens)
                            delta.output_tokens = Math.max(0, delta.output_tokens)
                            delta.estimated_cost_usd = Math.max(0, delta.estimated_cost_usd)

                            if (delta.total_requests > 0 || delta.total_tokens > 0 || delta.estimated_cost_usd > 0) {
                                mergeHourEntry(hourMap, hourBucket, apiKeyName, delta)
                            }
                        }
                    }
                    prevRaw = snap
                }
            }

            const apiKeyHourlySeries = Object.entries(hourMap)
                .map(([hour, data]) => {
                    const keys = Object.values(data.keys)
                        .map((k) => ({
                            ...k,
                            success_rate: k.total_requests > 0
                                ? Math.round((k.success_count / k.total_requests) * 1000) / 10
                                : 0,
                        }))
                        .sort((a, b) => b.total_requests - a.total_requests)
                    return {
                        hour,
                        total_requests: data.total_requests,
                        total_tokens: data.total_tokens,
                        total_cost: data.total_cost || 0,
                        keys,
                    }
                })
                .sort((a, b) => a.hour.localeCompare(b.hour))

            setCredentialTimeSeries({
                byDay: apiKeyDailySeries,
                byHour: apiKeyHourlySeries,
                meta: {
                    hasRawSnapshots: !snapshotsRawError,
                    hasHourlyData: apiKeyHourlySeries.length > 0,
                    rangeId,
                },
            })

            // Fallback: use credential_usage_summary (backward compat)
            if (!useDailyStats) {
                const rows = await selectSingle('credential_usage_summary', {
                    select: '*',
                    filters: [{ column: 'id', operator: 'eq', value: 1 }],
                })
                const error = rows ? null : { code: 'PGRST116', message: 'No rows found' }

                if (error) {
                    if (error.code === 'PGRST205' || error.message?.includes('relation') || error.message?.includes('does not exist') || error.message?.includes('Could not find')) {
                        setCredentialSetupRequired(true)
                    }
                    throw error
                }

                setCredentialData(rows)
                setCredentialTimeSeries({ byDay: [], byHour: [], meta: { hasRawSnapshots: false, hasHourlyData: false, rangeId } })
                setCredentialSetupRequired(false)
            }
        } catch (err) {
            console.error('Error fetching credential stats:', err)
            setCredentialTimeSeries({ byDay: [], byHour: [], meta: { hasRawSnapshots: false, hasHourlyData: false, rangeId } })
        } finally {
            setCredentialLoading(false)
        }
    }, [customRange, dateRange])

    const fetchData = useCallback(async (rangeId = dateRange, isInitial = false) => {
        try {
            if (isInitial) {
                setLoading(true)
            } else {
                setIsRefreshing(true)
            }

            const { startTime, endTime, startDate, endDate } = getDateBoundaries(rangeId, customRange)

            // 1. Fetch latest snapshot for raw_data (used for Rate Limits)
            const latestSnapshots = await selectRows('usage_snapshots', {
                select: '*',
                order: { column: 'collected_at', ascending: false },
                limit: 1,
            })

            if (latestSnapshots?.length > 0) {
                setStats(latestSnapshots[0])
                setLastUpdated(new Date(latestSnapshots[0].collected_at))
            }

            // 2. Fetch ALL snapshots within date range (including model_usage for granular delta)
            const snapshotsData = await selectRows('usage_snapshots', {
                select: 'id,collected_at,total_requests,success_count,failure_count,total_tokens,model_usage(model_name,request_count,total_tokens,estimated_cost_usd,input_tokens,output_tokens,reasoning_tokens,cached_tokens)',
                order: { column: 'collected_at', ascending: true },
                filters: [
                    ...(startTime ? [{ column: 'collected_at', operator: 'gte', value: startTime }] : []),
                    ...(endTime ? [{ column: 'collected_at', operator: 'lt', value: endTime }] : []),
                ],
            })

            // 2b. Fetch baseline snapshot (just before startTime) for accurate delta calculation
            let baselineSnapshot = null
            if (startTime && snapshotsData?.length > 0) {
                const baselineData = await selectRows('usage_snapshots', {
                    select: 'id,collected_at,total_requests,success_count,failure_count,total_tokens,model_usage(model_name,request_count,total_tokens,estimated_cost_usd)',
                    filters: [{ column: 'collected_at', operator: 'lt', value: startTime }],
                    order: { column: 'collected_at', ascending: false },
                    limit: 1,
                })

                baselineSnapshot = baselineData?.[0] || null
            }

            // 3. Calculate daily and hourly stats from snapshots
            const dailyMap = {}
            const hourlyMap = {}
            let prevSnapshot = baselineSnapshot  // Start with baseline instead of null

            if (snapshotsData?.length > 0) {
                for (const snap of snapshotsData) {
                    const snapTime = new Date(snap.collected_at)
                    const dateKey = snapTime.toLocaleDateString('en-CA') // YYYY-MM-DD in local timezone
                    const hourKey = snapTime.getHours().toString().padStart(2, '0')

                    if (prevSnapshot) {
                        const delta = {
                            requests: Math.max(0, snap.total_requests - prevSnapshot.total_requests),
                            tokens: Math.max(0, snap.total_tokens - prevSnapshot.total_tokens),
                            success: Math.max(0, snap.success_count - prevSnapshot.success_count),
                            failure: Math.max(0, snap.failure_count - prevSnapshot.failure_count)
                        }

                        // Aggregate by day
                        if (!dailyMap[dateKey]) {
                            dailyMap[dateKey] = { requests: 0, tokens: 0, success: 0, failure: 0 }
                        }
                        dailyMap[dateKey].requests += delta.requests
                        dailyMap[dateKey].tokens += delta.tokens
                        dailyMap[dateKey].success += delta.success
                        dailyMap[dateKey].failure += delta.failure

                        // Aggregate by hour
                        if (!hourlyMap[hourKey]) {
                            hourlyMap[hourKey] = { requests: 0, tokens: 0, models: {} }
                        }
                        hourlyMap[hourKey].requests += delta.requests
                        hourlyMap[hourKey].tokens += delta.tokens

                        // Model Breakdown Logic
                        const prevModels = new Map((prevSnapshot.model_usage || []).map(m => [m.model_name, m]))
                        const currModels = new Map((snap.model_usage || []).map(m => [m.model_name, m]))
                        const allModelNames = new Set([...prevModels.keys(), ...currModels.keys()])

                        for (const name of allModelNames) {
                            const p = prevModels.get(name) || { request_count: 0, total_tokens: 0, estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 }
                            const c = currModels.get(name) || { request_count: 0, total_tokens: 0, estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 }

                            // Calculate delta for this model
                            // Handle restarts (curr < prev) -> assume curr is the delta (approx)
                            let dReq = c.request_count - p.request_count
                            let dTok = c.total_tokens - p.total_tokens
                            let dCost = (c.estimated_cost_usd || 0) - (p.estimated_cost_usd || 0)
                            let dIn = (c.input_tokens || 0) - (p.input_tokens || 0)
                            let dOut = (c.output_tokens || 0) - (p.output_tokens || 0)
                            let dReasoning = (c.reasoning_tokens || 0) - (p.reasoning_tokens || 0)
                            let dCached = (c.cached_tokens || 0) - (p.cached_tokens || 0)

                            if (dReq < 0 || dTok < 0 || dCost < 0) {
                                dReq = c.request_count
                                dTok = c.total_tokens
                                dCost = c.estimated_cost_usd || 0
                                dIn = c.input_tokens || 0
                                dOut = c.output_tokens || 0
                                dReasoning = c.reasoning_tokens || 0
                                dCached = c.cached_tokens || 0
                            }

                            if (dReq > 0 || dTok > 0 || dCost > 0) {
                                if (!hourlyMap[hourKey].models[name]) hourlyMap[hourKey].models[name] = { requests: 0, tokens: 0, cost: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 }
                                hourlyMap[hourKey].models[name].requests += dReq
                                hourlyMap[hourKey].models[name].tokens += dTok
                                hourlyMap[hourKey].models[name].cost += dCost
                                hourlyMap[hourKey].models[name].input_tokens += Math.max(0, dIn)
                                hourlyMap[hourKey].models[name].output_tokens += Math.max(0, dOut)
                                hourlyMap[hourKey].models[name].reasoning_tokens += Math.max(0, dReasoning)
                                hourlyMap[hourKey].models[name].cached_tokens += Math.max(0, dCached)
                            }
                        }
                    }
                    prevSnapshot = snap
                }
            }

            // Convert daily map to array (requests/tokens derived from snapshots)
            const calculatedDailyArray = Object.entries(dailyMap)
                .map(([date, data]) => ({
                    stat_date: date,
                    total_requests: data.requests,
                    total_tokens: data.tokens,
                    success_count: data.success,
                    failure_count: data.failure,
                    estimated_cost_usd: 0
                }))
                .sort((a, b) => a.stat_date.localeCompare(b.stat_date))

            // Fetch authoritative data from daily_stats table
            let dailyStatsFromDB = {}  // Keyed by stat_date
            let breakdownByDate = {} // Store breakdown for daily stats
            let aggregatedBreakdown = { models: {}, endpoints: {} }
            let hasBreakdownData = false

            // For 'all' time, we want all daily stats, otherwise respect startDate
            if (rangeId === 'all' || startDate) {
                const dailyStatsRows = await selectRows('daily_stats', {
                    select: 'stat_date,total_requests,total_tokens,success_count,failure_count,estimated_cost_usd,breakdown',
                    filters: [
                        ...(startDate ? [{ column: 'stat_date', operator: 'gte', value: startDate }] : []),
                        ...(endDate ? [{ column: 'stat_date', operator: 'lt', value: endDate }] : []),
                    ],
                })
                dailyStatsRows?.forEach(row => {
                    dailyStatsFromDB[row.stat_date] = {
                        total_requests: row.total_requests || 0,
                        total_tokens: row.total_tokens || 0,
                        success_count: row.success_count || 0,
                        failure_count: row.failure_count || 0,
                        estimated_cost_usd: parseFloat(row.estimated_cost_usd) || 0
                    }

                    // Aggregate Breakdown from JSON
                    if (row.breakdown) {
                        hasBreakdownData = true
                        const b = row.breakdown

                        // Store daily breakdown for charts
                        if (b.models) {
                             breakdownByDate[row.stat_date] = b.models
                        }

                        // Merge Models
                        if (b.models) {
                            for (const [mName, data] of Object.entries(b.models)) {
                                if (!aggregatedBreakdown.models[mName]) {
                                    aggregatedBreakdown.models[mName] = {
                                        model_name: mName,
                                        request_count: 0,
                                        total_tokens: 0,
                                        estimated_cost_usd: 0,
                                        input_tokens: 0,
                                        output_tokens: 0,
                                        reasoning_tokens: 0,
                                        cached_tokens: 0,
                                    }
                                }
                                const m = aggregatedBreakdown.models[mName]
                                m.request_count += data.requests || 0
                                m.total_tokens += data.tokens || 0
                                m.estimated_cost_usd += data.cost || 0
                                m.input_tokens += data.input_tokens || 0
                                m.output_tokens += data.output_tokens || 0
                                m.reasoning_tokens += data.reasoning_tokens || 0
                                m.cached_tokens += data.cached_tokens || 0
                            }
                        }

                        // Merge Endpoints
                        if (b.endpoints) {
                             for (const [epName, data] of Object.entries(b.endpoints)) {
                                 if (!aggregatedBreakdown.endpoints[epName]) {
                                     aggregatedBreakdown.endpoints[epName] = {
                                         api_endpoint: epName,
                                         request_count: 0,
                                         estimated_cost_usd: 0,
                                         models: {} // Track nested model usage
                                     }
                                 }
                                 const e = aggregatedBreakdown.endpoints[epName]
                                 e.request_count += data.requests || 0
                                 e.estimated_cost_usd += data.cost || 0

                                 // Merge nested models if available
                                 if (data.models) {
                                     for (const [mName, mData] of Object.entries(data.models)) {
                                         if (!e.models[mName]) {
                                             e.models[mName] = { requests: 0, cost: 0, tokens: 0 }
                                         }
                                         e.models[mName].requests += mData.requests || 0
                                         e.models[mName].cost += mData.cost || 0
                                         e.models[mName].tokens += mData.tokens || 0
                                     }
                                 }
                            }
                        }
                    }
                })
            }

            // Merge calculated data with daily_stats data
            // Priority: Use daily_stats if available (authoritative), fallback to calculated data
            const allDates = new Set([
                ...Object.keys(dailyMap),
                ...Object.keys(dailyStatsFromDB)
            ])

            const mergedDailyArray = Array.from(allDates).map(dateKey => {
                const fromDB = dailyStatsFromDB[dateKey]
                const calculated = dailyMap[dateKey]

                // Prefer DB data if available, otherwise use calculated
                return {
                    stat_date: dateKey,
                    total_requests: fromDB?.total_requests ?? (calculated?.requests || 0),
                    total_tokens: fromDB?.total_tokens ?? (calculated?.tokens || 0),
                    success_count: fromDB?.success_count ?? (calculated?.success || 0),
                    failure_count: fromDB?.failure_count ?? (calculated?.failure || 0),
                    estimated_cost_usd: fromDB?.estimated_cost_usd ?? 0,
                    models: breakdownByDate[dateKey] || {}
                }
            }).sort((a, b) => a.stat_date.localeCompare(b.stat_date))

            setDailyStats(mergedDailyArray)

            // Convert hourly map to array
            const now = new Date()
            const hoursToShow = rangeId === 'today' ? now.getHours() + 1 : 24
            const hourlyArray = Array.from({ length: hoursToShow }, (_, i) => {
                const hourKey = i.toString().padStart(2, '0')
                const hData = hourlyMap[hourKey] || { requests: 0, tokens: 0, models: {} }

                // Flatten model usage for easy chart consumption
                // Structure: { time, requests, tokens, models: { "gpt-4": { requests: 10, tokens: 100, cost: 0.05 }, ... } }
                return {
                    time: `${hourKey}:00`,
                    requests: hData.requests,
                    tokens: hData.tokens,
                    models: hData.models || {}
                }
            })
            setHourlyStats(hourlyArray)

            // 4. Get model usage
            // PRIORITY: Use Aggregated Breakdown if available (Performance Optimization)
            if (hasBreakdownData) {
                 const finalModels = Object.values(aggregatedBreakdown.models)
                    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
                 setModelUsage(finalModels)

                 const finalEndpoints = Object.values(aggregatedBreakdown.endpoints)
                    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
                 setEndpointUsage(finalEndpoints)
            } else {
                // FALLBACK: Old Snapshot Logic (Slow, but full detail including input/output tokens)
                // ... (Keep existing logic as else block)
                if (snapshotsData?.length > 0) {
                     // ... existing snapshot processing ...
                     // I need to wrap the existing logic in this else block.
                     // But wait, the existing logic is huge.
                     // I will implement this by conditionally executing the snapshot logic.
                } else {
                    setModelUsage([])
                    setEndpointUsage([])
                }
            }

            // To properly wrap, I'll use a guard clause or boolean flag.
            const runSnapshotLogic = !hasBreakdownData && snapshotsData?.length > 0;

            if (runSnapshotLogic) {
                let totalByModel = new Map()
                // ... (rest of the existing logic) ...


                // Helper function to clean arrays (remove null/undefined)
                const cleanArray = (arr) => arr.filter(x => x !== null && x !== undefined);

                // 1. Identify "Critical Points" (Baseline, Peaks, Last Snapshot)

                // We need a baseline (snapshot BEFORE the range) to calculate valid delta for the first segment.
                // If no baseline (e.g. All Time), assume 0 for all counters.
                let baselineId = null;
                if (startTime) {
                    const baselineData = await selectRows('usage_snapshots', {
                        select: 'id,collected_at,total_requests,success_count,failure_count,total_tokens',
                        filters: [{ column: 'collected_at', operator: 'lt', value: startTime }],
                        order: { column: 'collected_at', ascending: false },
                        limit: 1,
                    })

                    baselineId = baselineData?.[0]?.id;
                }

                // Handling for "Missing Baseline" in specific date ranges (e.g. "Today" but first install was at noon)
                // If we have a startTime (not All Time) but NO baseline found, we must treat the FIRST snapshot
                // of the range as the baseline to avoid counting its cumulative value as "Today's usage".
                let effectiveBaselineId = baselineId;
                let startIdx = 0;

                if (startTime && !baselineId && snapshotsData.length > 0) {
                     effectiveBaselineId = snapshotsData[0].id;
                     // We start processing critical points from the NEXT snapshot,
                     // effectively ignoring the first snapshot's absolute value (delta = 0)
                     // But we still need to check if it's a critical point itself?
                     // No, if it's the baseline, it's the reference.
                     startIdx = 0; // We will handle this by filtering criticalSnapIds
                }

                const criticalSnapIds = [];

                // Iterate snapshotsData to find "peaks" (snapshots immediately preceding a reset)
                for (let i = startIdx; i < snapshotsData.length - 1; i++) {
                    const curr = snapshotsData[i];
                    const next = snapshotsData[i + 1];

                    // Detect a global restart if total_requests or total_tokens drop significantly
                    // A simple drop check is sufficient for CLIProxy's global counters
                    if (next.total_requests < curr.total_requests || next.total_tokens < curr.total_tokens) {
                        criticalSnapIds.push(curr.id); // This 'curr' is a peak before a reset
                    }
                }
                // Always include the very last snapshot in the range as a critical point
                // Unless the range only had 1 snapshot and we used it as baseline?
                if (snapshotsData.length > 0) {
                     const lastId = snapshotsData[snapshotsData.length - 1].id;
                     if (lastId !== effectiveBaselineId) {
                         criticalSnapIds.push(lastId);
                     }
                }

                // 2. Fetch detailed model usage for Baseline and all Critical Points
                const allSnapIdsToFetch = cleanArray([effectiveBaselineId, ...criticalSnapIds]);
                // Ensure unique IDs
                const uniqueSnapIds = [...new Set(allSnapIdsToFetch)];

                // If we have a lot of critical points (e.g. erratic server over a year), we might need to batch this.
                // For now, assuming < 100 restarts is safe for a single 'in' query.
                // CRITICAL: Supabase defaults to 1000 rows. With many snapshots, this query can return thousands of rows.
                // We MUST increase the limit.
                const usageRecords = await selectRows('model_usage', {
                    select: 'snapshot_id,model_name,api_endpoint,request_count,input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens,estimated_cost_usd',
                    filters: [{ column: 'snapshot_id', operator: 'in', value: uniqueSnapIds }],
                    limit: 100000,
                }) // Increase limit to ensure we get all records

                // Group fetched usage records by Snapshot ID -> Map<snapshot_id, Map<composite_key, model_usage_data>>
                const snapMap = new Map();
                usageRecords?.forEach(record => {
                    if (!snapMap.has(record.snapshot_id)) {
                        snapMap.set(record.snapshot_id, new Map());
                    }
                    const key = `${record.model_name}|||${record.api_endpoint}`;
                    snapMap.get(record.snapshot_id).set(key, record);
                });

                // 3. Calculate total usage by summing deltas between critical points
                let prevModelUsageMap = snapMap.get(effectiveBaselineId) || new Map(); // Start with baseline or empty map

                // If effectiveBaselineId was snapshotsData[0] (because real baseline missing),
                // prevModelUsageMap is populated with its data.
                // If effectiveBaselineId was null (All Time), prevModelUsageMap is empty.

                for (const currentSnapId of criticalSnapIds) {
                    const currentModelUsageMap = snapMap.get(currentSnapId);
                    if (!currentModelUsageMap) {
                         // If we requested it but it's missing (e.g. partial data), skip to avoid crash
                         // But we must NOT update prevModelUsageMap to keep continuity from valid baseline
                         continue;
                    }

                    // Get all unique model+endpoint keys present in either previous or current map
                    const allKeys = new Set([...prevModelUsageMap.keys(), ...currentModelUsageMap.keys()]);

                    for (const key of allKeys) {
                        const prev = prevModelUsageMap.get(key) || { request_count: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 };
                        const curr = currentModelUsageMap.get(key) || { request_count: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 };

                        let deltaReq = 0, deltaIn = 0, deltaOut = 0, deltaReasoning = 0, deltaCached = 0, deltaTotal = 0, deltaCost = 0;

                        // Determine if a reset occurred for this specific model+endpoint key
                        // A reset is indicated if current counters are less than previous counters
                        const isReset = curr.total_tokens < prev.total_tokens || curr.request_count < prev.request_count;

                        if (isReset) {
                            // If reset, the usage for this segment is simply the current value
                            // (assuming it started from ~0 after the reset)
                            deltaReq = curr.request_count;
                            deltaIn = curr.input_tokens;
                            deltaOut = curr.output_tokens;
                            deltaReasoning = curr.reasoning_tokens || 0;
                            deltaCached = curr.cached_tokens || 0;
                            deltaTotal = curr.total_tokens;
                            deltaCost = parseFloat(curr.estimated_cost_usd || 0);
                        } else {
                            // No reset, calculate the difference
                            deltaReq = curr.request_count - prev.request_count;
                            deltaIn = curr.input_tokens - prev.input_tokens;
                            deltaOut = curr.output_tokens - prev.output_tokens;
                            deltaReasoning = (curr.reasoning_tokens || 0) - (prev.reasoning_tokens || 0);
                            deltaCached = (curr.cached_tokens || 0) - (prev.cached_tokens || 0);
                            deltaTotal = curr.total_tokens - prev.total_tokens;
                            deltaCost = parseFloat(curr.estimated_cost_usd || 0) - parseFloat(prev.estimated_cost_usd || 0);
                        }

                        // Only add positive deltas (usage cannot be negative)
                        if (deltaReq > 0 || deltaCost > 0) {
                            if (!totalByModel.has(key)) {
                                totalByModel.set(key, {
                                    model_name: curr.model_name || prev.model_name,
                                    api_endpoint: curr.api_endpoint || prev.api_endpoint,
                                    request_count: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0, estimated_cost_usd: 0
                                });
                            }
                            const item = totalByModel.get(key);
                            item.request_count += deltaReq;
                            item.input_tokens += deltaIn;
                            item.output_tokens += deltaOut;
                            item.reasoning_tokens += deltaReasoning;
                            item.cached_tokens += deltaCached;
                            item.total_tokens += deltaTotal;
                            item.estimated_cost_usd += deltaCost;
                        }
                    }
                    // Move current map to previous for the next iteration
                    prevModelUsageMap = currentModelUsageMap;
                }

                // Final Aggregation: Split into Model Usage (Summed) and Endpoint Usage (Granular)

                // 1. Model Usage: Group by model_name
                const modelMap = new Map()
                // 2. Endpoint Usage: This is already totalByModel (keyed by composite), but we should ensure valid list

                for (const [key, data] of totalByModel) {
                    const mName = data.model_name
                    if (!modelMap.has(mName)) {
                        modelMap.set(mName, {
                            model_name: mName,
                            api_endpoint: data.api_endpoint,
                            request_count: 0,
                            input_tokens: 0,
                            output_tokens: 0,
                            reasoning_tokens: 0,
                            cached_tokens: 0,
                            total_tokens: 0,
                            estimated_cost_usd: 0
                        })
                    }
                    const mExisting = modelMap.get(mName)
                    mExisting.request_count += data.request_count
                    mExisting.input_tokens += data.input_tokens
                    mExisting.output_tokens += data.output_tokens
                    mExisting.reasoning_tokens += data.reasoning_tokens || 0
                    mExisting.cached_tokens += data.cached_tokens || 0
                    mExisting.total_tokens += data.total_tokens
                    mExisting.estimated_cost_usd += data.estimated_cost_usd
                    // Note: api_endpoint aggregation for Model List isn't strictly needed as list doesn't show it,
                    // but if it does, we'd need a Set. For now, one endpoint is fine or ignore.
                }

                const finalModels = Array.from(modelMap.values())
                setModelUsage(finalModels.sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd))

                // Endpoint Usage (for API Keys chart)
                // We aggregate by api_endpoint (summing across models for the same key) or keep separate?
                // The API Keys chart typically shows: "sk-abc (Gemini)": Usage?
                // Or just "sk-abc": Usage?
                // The Dashboard previously derived it from "modelUsage".
                // If we want "One bar per API Key", we sort by API Key.
                // If one API key is used for multiple models, do we group them? YES.

                const endpointMap = new Map()
                for (const [key, data] of totalByModel) {
                    const ep = data.api_endpoint
                    if (!endpointMap.has(ep)) {
                        endpointMap.set(ep, {
                            api_endpoint: ep,
                            model_name: data.model_name, // Representative
                            request_count: 0,
                            input_tokens: 0,
                            output_tokens: 0,
                            total_tokens: 0,
                            estimated_cost_usd: 0
                        })
                    }
                    const eExisting = endpointMap.get(ep)
                    eExisting.request_count += data.request_count
                    eExisting.estimated_cost_usd += data.estimated_cost_usd
                    // We can track models used too
                }

                setEndpointUsage(Array.from(endpointMap.values()))
            }

            // 5. Fetch skill runs + daily stats
            let skillRunsQuery = supabase
                .from('skill_runs')
                .select('event_uid,tool_use_id,skill_name,session_id,machine_id,source,triggered_at,status,error_type,error_message,attempt_no,tokens_used,output_tokens,duration_ms,model,tool_calls,estimated_cost_usd,is_skeleton,project_dir')
                .eq('is_skeleton', false)
                .order('triggered_at', { ascending: false })
                .limit(1000)

            if (startTime) {
                skillRunsQuery = skillRunsQuery.gte('triggered_at', startTime)
            }
            if (endTime) {
                skillRunsQuery = skillRunsQuery.lt('triggered_at', endTime)
            }

            let skillDailyQuery = supabase
                .from('skill_daily_stats')
                .select('*')
                .order('stat_date', { ascending: true })

            if (startDate) {
                skillDailyQuery = skillDailyQuery.gte('stat_date', startDate)
            }
            if (endDate) {
                skillDailyQuery = skillDailyQuery.lt('stat_date', endDate)
            }

            let appLogsQuery = supabase
                .from('app_logs')
                .select('id,event_uid,logged_at,source,category,severity,title,message,details,session_id,machine_id,project_dir')
                .order('logged_at', { ascending: false })
                .order('id', { ascending: false })
                .limit(APP_LOGS_PAGE_SIZE)

            if (startTime) {
                appLogsQuery = appLogsQuery.gte('logged_at', startTime)
            }
            if (endTime) {
                appLogsQuery = appLogsQuery.lt('logged_at', endTime)
            }

            const [{ data: skillRunsData }, { data: skillDailyData }, { data: appLogsData }] = await Promise.all([
                skillRunsQuery,
                skillDailyQuery,
                appLogsQuery,
            ])

            const appRows = appLogsData || []

            setSkillRuns(skillRunsData || [])
            setSkillDailyStats(skillDailyData || [])
            setAppLogs(appRows)

            setLoading(false)
            setIsRefreshing(false)
        } catch (error) {
            console.error('Error fetching data:', error)
            setLoading(false)
            setIsRefreshing(false)
        }
    }, [customRange, dateRange])

    // Refetch when dateRange changes (both main data and credential stats)
    useEffect(() => {
        fetchData(dateRange)
        fetchCredentialStats(dateRange)
    }, [dateRange, fetchData, fetchCredentialStats])

    useEffect(() => {
        const interval = setInterval(() => {
            fetchData(dateRange)
            fetchCredentialStats(dateRange)
        }, FRONTEND_AUTO_REFRESH_MS)

        return () => {
            clearInterval(interval)
        }
    }, [dateRange, fetchData, fetchCredentialStats])

    // Trigger collector to fetch fresh data from CLIProxy
    const triggerCollector = async () => {
        // In production (Docker): use relative URL via nginx proxy
        // In development: fallback to localhost:5001
        const isProduction = import.meta.env.PROD
        const collectorUrl = isProduction
            ? '/api/collector/trigger'  // Nginx proxies this to collector container
            : (import.meta.env.VITE_COLLECTOR_URL || 'http://localhost:5001') + '/trigger'

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

            const response = await fetch(collectorUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal
            })
            clearTimeout(timeoutId)

            if (!response.ok) {
                console.warn(`Collector trigger failed with status: ${response.status}`)
                return false
            }

            const result = await response.json()
            console.log('Collector trigger result:', result)
            return result.status === 'success'
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('Collector trigger timed out')
            } else {
                console.warn('Could not trigger collector:', error.message)
            }
            return false
        }
    }

    const handleDateRangeChange = async (days, shouldTriggerCollector = false) => {
        if (shouldTriggerCollector) {
            setIsRefreshing(true)
            try {
                await triggerCollector()
                // Small delay to let collector store data
                await new Promise(resolve => setTimeout(resolve, 500))

                // If date range hasn't changed, useEffect won't run, so we must fetch manually
                if (days === dateRange) {
                    await fetchData()
                    await fetchCredentialStats(dateRange)
                }
            } catch (e) {
                console.error('Trigger error:', e)
                setIsRefreshing(false)
            }
        }
        setDateRange(days)
    }

    const clearAllAppLogs = useCallback(async () => {
        const isProduction = import.meta.env.PROD
        const collectorBase = isProduction
            ? '/api/collector'
            : (import.meta.env.VITE_COLLECTOR_URL || 'http://localhost:5001')

        const response = await fetch(`${collectorBase}/logs/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: 'all' })
        })

        if (!response.ok) {
            throw new Error(`Clear logs failed: ${response.status}`)
        }

        await fetchData(dateRange)
    }, [dateRange, fetchData])

    // Show loading while checking auth
    if (authChecking) {
        return (
            <div style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#1a1a2e',
                color: '#fff'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', marginBottom: '10px' }}>Loading...</div>
                </div>
            </div>
        )
    }

    // Show login if not authenticated (and auth is enabled)
    if (!isAuthenticated && authEnabled) {
        return <Login onLogin={handleLogin} authEnabled={authEnabled} />
    }

    const handleCustomRangeApply = (range) => {
        setCustomRange({
            startDate: range.startDate || null,
            endDate: range.endDate || null
        })
        setDateRange('custom')
    }

    return (
        <div className="app">
            <Dashboard
                stats={stats}
                dailyStats={dailyStats}
                modelUsage={modelUsage}
                hourlyStats={hourlyStats}
                loading={loading}
                isRefreshing={isRefreshing}
                lastUpdated={lastUpdated}
                dateRange={dateRange}
                onDateRangeChange={handleDateRangeChange}
                customRange={customRange}
                onCustomRangeApply={handleCustomRangeApply}
                endpointUsage={endpointUsage}
                credentialData={credentialData}
                credentialTimeSeries={credentialTimeSeries}
                credentialLoading={credentialLoading}
                credentialSetupRequired={credentialSetupRequired}
                onLogout={handleLogout}
                isAuthenticated={isAuthenticated}
                skillRuns={skillRuns}
                skillDailyStats={skillDailyStats}
                appLogs={appLogs}
                onClearAllLogs={clearAllAppLogs}
            />
        </div>
    )
}

export default App
