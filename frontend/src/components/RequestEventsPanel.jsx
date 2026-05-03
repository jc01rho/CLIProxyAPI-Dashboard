import { useMemo, useState } from 'react'
import { CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, Cell, PieChart, Pie } from 'recharts'

const PAGE_SIZE = 500
const formatDateTime = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString()
}

const formatNumber = (num) => {
    if (num === undefined || num === null) return '0'
    return Math.round(num).toLocaleString('en-US')
}

const formatCurrency = (num) => {
    if (num === undefined || num === null) return '$0.00'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(num)
}

const compactText = (text, max = 72) => {
    const value = String(text || 'Unknown')
    return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

const getStatus = (failed) => failed ? 'failure' : 'success'

const calculatePercentiles = (values) => {
    if (!values || values.length === 0) return { p50: 0, p95: 0, p99: 0 }
    const sorted = [...values].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length * 0.5)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    const p99 = sorted[Math.floor(sorted.length * 0.99)]
    return { p50, p95, p99 }
}

const inferProvider = (endpoint, model) => {
    if (!endpoint && !model) return 'Unknown'
    const e = (endpoint || '').toLowerCase()
    const m = (model || '').toLowerCase()

    if (e.includes('openai') || m.includes('gpt')) return 'OpenAI'
    if (e.includes('anthropic') || m.includes('claude')) return 'Anthropic'
    if (e.includes('gemini') || e.includes('googleapis') || m.includes('gemini')) return 'Google'
    if (e.includes('xai') || m.includes('grok')) return 'xAI'
    if (e.includes('deepseek') || m.includes('deepseek')) return 'DeepSeek'
    if (e.includes('qwen') || e.includes('alibaba') || m.includes('qwen')) return 'Alibaba'
    if (e.includes('cohere') || m.includes('command')) return 'Cohere'

    return 'Other'
}
const encodeCsv = (value) => {
    const text = String(value ?? '')
    const trimmedLeft = text.replace(/^\s+/, '')
    const safeText = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text
    return `"${safeText.replace(/"/g, '""')}"`
}

function RequestEventsPanel({ requestEvents = [] }) {
    const [modelFilter, setModelFilter] = useState('all')
    const [sourceFilter, setSourceFilter] = useState('all')
    const [authFilter, setAuthFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [providerFilter, setProviderFilter] = useState('all')
    const [page, setPage] = useState(1)
    const [tableSortCol, setTableSortCol] = useState('occurred_at')
    const [tableSortDir, setTableSortDir] = useState('desc')

    const baseEvents = useMemo(() => Array.isArray(requestEvents) ? requestEvents : [], [requestEvents])

    const { models, sources, auths, providers } = useMemo(() => {
        const m = new Set()
        const s = new Set()
        const a = new Set()
        const p = new Set()
        for (const ev of baseEvents) {
            if (ev.model_name) m.add(ev.model_name)
            if (ev.source_id) s.add(ev.source_id)
            if (ev.auth_index) a.add(ev.auth_index)
            p.add(ev.provider || inferProvider(ev.api_endpoint, ev.model_name))
        }
        return {
            models: Array.from(m).sort(),
            sources: Array.from(s).sort(),
            auths: Array.from(a).sort(),
            providers: Array.from(p).filter(Boolean).sort()
        }
    }, [baseEvents])

    const filteredEvents = useMemo(() => {
        return baseEvents.filter(ev => {
            if (modelFilter !== 'all' && ev.model_name !== modelFilter) return false
            if (sourceFilter !== 'all' && ev.source_id !== sourceFilter) return false
            if (authFilter !== 'all' && ev.auth_index !== authFilter) return false
            const provider = ev.provider || inferProvider(ev.api_endpoint, ev.model_name)
            if (providerFilter !== 'all' && provider !== providerFilter) return false
            if (statusFilter !== 'all') {
                const isFailure = !!ev.failed
                if (statusFilter === 'success' && isFailure) return false
                if (statusFilter === 'failure' && !isFailure) return false
            }
            return true
        })
    }, [baseEvents, modelFilter, sourceFilter, authFilter, providerFilter, statusFilter])

    const sortedEvents = useMemo(() => {
        return [...filteredEvents].sort((a, b) => {
            let va = a[tableSortCol]
            let vb = b[tableSortCol]

            if (tableSortCol === 'status') {
                va = getStatus(a.failed)
                vb = getStatus(b.failed)
            }

            const cmp = typeof va === 'number' ? va - vb : String(va || '').localeCompare(String(vb || ''))
            return tableSortDir === 'asc' ? cmp : -cmp
        })
    }, [filteredEvents, tableSortCol, tableSortDir])

    const summary = useMemo(() => {
        let totalLatency = 0
        let maxLatency = 0
        let count = 0
        let successes = 0
        let failures = 0
        let latencies = []
        let totalCost = 0
        let providerStats = {}
        let endpointStats = {}
        let modelStats = {}
        let tokenBreakdown = { input: 0, output: 0, reasoning: 0, cached: 0 }

        for (const ev of filteredEvents) {
            const lat = Number(ev.latency_ms) || 0
            if (lat > 0) {
                totalLatency += lat
                if (lat > maxLatency) maxLatency = lat
                count++
                latencies.push(lat)
            }
            if (ev.failed) failures++
            else successes++

            const cost = Number(ev.estimated_cost_usd) || 0
            totalCost += cost

            const prov = ev.provider || inferProvider(ev.api_endpoint, ev.model_name)
            if (!providerStats[prov]) providerStats[prov] = { requests: 0, cost: 0, errors: 0 }
            providerStats[prov].requests++
            providerStats[prov].cost += cost
            if (ev.failed) providerStats[prov].errors++

            const ep = ev.api_endpoint || 'Unknown'
            if (!endpointStats[ep]) endpointStats[ep] = { requests: 0, errors: 0, cost: 0, tokens: 0, latency: [], models: new Set() }
            endpointStats[ep].requests++
            if (ev.failed) endpointStats[ep].errors++
            endpointStats[ep].cost += cost
            endpointStats[ep].tokens += Number(ev.total_tokens) || 0
            if (ev.model_name) endpointStats[ep].models.add(ev.model_name)
            if (lat > 0) endpointStats[ep].latency.push(lat)

            const model = ev.model_name || 'Unknown'
            if (!modelStats[model]) modelStats[model] = { requests: 0, cost: 0, tokens: 0, errors: 0, provider: prov }
            modelStats[model].requests++
            modelStats[model].cost += cost
            modelStats[model].tokens += Number(ev.total_tokens) || 0
            if (ev.failed) modelStats[model].errors++

            tokenBreakdown.input += Number(ev.input_tokens) || 0
            tokenBreakdown.output += Number(ev.output_tokens) || 0
            tokenBreakdown.reasoning += Number(ev.reasoning_tokens) || 0
            tokenBreakdown.cached += Number(ev.cached_tokens) || 0
        }

        const { p50, p95, p99 } = calculatePercentiles(latencies)

        const healthScore = count > 0 ? (successes / (successes + failures)) * 100 : 100

        return {
            avgLatency: count > 0 ? Math.round(totalLatency / count) : 0,
            maxLatency,
            p50, p95, p99,
            sampleCount: count,
            successes,
            failures,
            total: filteredEvents.length,
            totalCost,
            providerStats,
            endpointStats,
            modelStats,
            tokenBreakdown,
            healthScore
        }
    }, [filteredEvents])

    const endpointRows = useMemo(() => {
        return Object.entries(summary.endpointStats)
            .map(([endpoint, data]) => {
                const latency = data.latency.length ? Math.round(data.latency.reduce((a, b) => a + b, 0) / data.latency.length) : 0
                return { endpoint, ...data, modelCount: data.models?.size || 0, avgLatency: latency }
            })
            .sort((a, b) => b.requests - a.requests)
            .slice(0, 10)
    }, [summary.endpointStats])

    const modelRows = useMemo(() => {
        return Object.entries(summary.modelStats)
            .map(([model, data]) => ({ model, ...data }))
            .sort((a, b) => b.cost - a.cost || b.requests - a.requests)
            .slice(0, 10)
    }, [summary.modelStats])

    const tokenPieData = useMemo(() => [
        { name: 'Input', value: summary.tokenBreakdown.input, fill: '#3b82f6' },
        { name: 'Output', value: summary.tokenBreakdown.output, fill: '#8b5cf6' },
        { name: 'Reasoning', value: summary.tokenBreakdown.reasoning, fill: '#10b981' },
        { name: 'Cached', value: summary.tokenBreakdown.cached, fill: '#f59e0b' },
    ].filter(item => item.value > 0), [summary.tokenBreakdown])

    const handleTableSort = (key) => {
        if (tableSortCol === key) {
            setTableSortDir(d => d === 'desc' ? 'asc' : 'desc')
        } else {
            setTableSortCol(key)
            setTableSortDir('desc')
        }
    }

    function SortIcon({ column }) {
        if (tableSortCol !== column) return <span className="sort-icon"> ↕</span>
        return <span className="sort-icon active">{tableSortDir === 'asc' ? ' ↑' : ' ↓'}</span>
    }

    const clearFilters = () => {
        setModelFilter('all')
        setSourceFilter('all')
        setAuthFilter('all')
        setStatusFilter('all')
        setProviderFilter('all')
    }

    const handleExportCsv = () => {
        if (!filteredEvents.length) return

        const csvHeader = [
            'timestamp',
            'model',
            'api_endpoint',
            'source_id',
            'auth_index',
            'result',
            'latency_ms',
            'input_tokens',
            'output_tokens',
            'reasoning_tokens',
            'cached_tokens',
            'total_tokens',
            'provider',
            'estimated_cost_usd'
        ]

        const csvRows = filteredEvents.map((row) =>
            [
                row.occurred_at,
                row.model_name,
                row.api_endpoint,
                row.source_id,
                row.auth_index,
                row.failed ? 'failed' : 'success',
                row.latency_ms ?? '',
                row.input_tokens,
                row.output_tokens,
                row.reasoning_tokens,
                row.cached_tokens,
                row.total_tokens,
                row.provider || inferProvider(row.api_endpoint, row.model_name),
                row.estimated_cost_usd ?? '0'
            ]
                .map((value) => encodeCsv(value))
                .join(',')
        )

        const content = [csvHeader.join(','), ...csvRows].join('\n')
        const fileTime = new Date().toISOString().replace(/[:.]/g, '-')
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `request-events-${fileTime}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    const columns = [
        { key: 'occurred_at', label: 'Time', sortable: true },
        { key: 'model_name', label: 'Model', sortable: true },
        { key: 'provider', label: 'Provider', sortable: true },
        { key: 'api_endpoint', label: 'Endpoint', sortable: true },
        { key: 'source_id', label: 'Source', sortable: true },
        { key: 'auth_index', label: 'Auth Index', sortable: true },
        { key: 'status', label: 'Status', sortable: true },
        { key: 'latency_ms', label: 'Latency (ms)', sortable: true },
        { key: 'input_tokens', label: 'Input', sortable: true },
        { key: 'output_tokens', label: 'Output', sortable: true },
        { key: 'reasoning_tokens', label: 'Reasoning', sortable: true },
        { key: 'cached_tokens', label: 'Cached', sortable: true },
        { key: 'total_tokens', label: 'Total Tokens', sortable: true },
        { key: 'estimated_cost_usd', label: 'Cost', sortable: true },
    ]

    return (
        <div className="skills-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">EVENTS</span></div>
                    <div className="stat-value">{formatNumber(summary.total)}</div>
                    <div className="stat-meta">{formatNumber(summary.successes)} success · {formatNumber(summary.failures)} failure</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">AVG LATENCY</span></div>
                    <div className="stat-value">{formatNumber(summary.avgLatency)} ms</div>
                    <div className="stat-meta">P50: {formatNumber(summary.p50)}ms / P95: {formatNumber(summary.p95)}ms / P99: {formatNumber(summary.p99)}ms</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">TOTAL COST</span></div>
                    <div className="stat-value">{formatCurrency(summary.totalCost)}</div>
                    <div className="stat-meta">Health Score: {Math.round(summary.healthScore)}%</div>
                </div>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">INPUT TOKENS</span></div>
                    <div className="stat-value">{formatNumber(summary.tokenBreakdown.input)}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">OUTPUT TOKENS</span></div>
                    <div className="stat-value">{formatNumber(summary.tokenBreakdown.output)}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">REASONING/CACHED</span></div>
                    <div className="stat-value">{formatNumber(summary.tokenBreakdown.reasoning)} / {formatNumber(summary.tokenBreakdown.cached)}</div>
                </div>
            </div>

            <div className="chart-card chart-full" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', background: 'transparent', padding: 0, border: 'none' }}>
                <div className="chart-card" style={{ margin: 0 }}>
                    <div className="chart-header">
                        <h3>Token Breakdown</h3>
                    </div>
                    <div style={{ height: '300px' }}>
                        {tokenPieData.length ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={tokenPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} dataKey="value">
                                        {tokenPieData.map((entry, index) => <Cell key={`token-${index}`} fill={entry.fill} />)}
                                    </Pie>
                                    <Tooltip formatter={(value) => formatNumber(value)} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <div className="empty">No token data</div>}
                    </div>
                </div>
                <div className="chart-card" style={{ margin: 0 }}>
                    <div className="chart-header">
                        <h3>Provider Cost Breakdown</h3>
                    </div>
                    <div style={{ height: '300px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={Object.entries(summary.providerStats).map(([k, v]) => ({ name: k, value: v.cost }))}
                                    cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value"
                                >
                                    {Object.keys(summary.providerStats).map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={`hsl(${(index * 137.5) % 360}, 70%, 50%)`} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => formatCurrency(value)} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="chart-card" style={{ margin: 0 }}>
                    <div className="chart-header">
                        <h3>Provider Request Volume</h3>
                    </div>
                    <div style={{ height: '300px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={Object.entries(summary.providerStats).map(([k, v]) => ({ name: k, requests: v.requests, errors: v.errors }))}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="requests" stackId="a" fill="#00ff9d" name="Success" />
                                <Bar dataKey="errors" stackId="a" fill="#ff3366" name="Errors" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="chart-card chart-full" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px', background: 'transparent', padding: 0, border: 'none' }}>
                <div className="chart-card" style={{ margin: 0 }}>
                    <div className="chart-header"><h3>API Details</h3></div>
                    <div className="table-wrapper">
                        <table className="data-table">
                            <thead><tr><th>Endpoint</th><th>Requests</th><th>Errors</th><th>Models</th><th>Avg Latency</th><th>Cost</th></tr></thead>
                            <tbody>
                                {endpointRows.length ? endpointRows.map(row => (
                                    <tr key={row.endpoint}>
                                        <td title={row.endpoint}>{compactText(row.endpoint)}</td>
                                        <td>{formatNumber(row.requests)}</td>
                                        <td>{formatNumber(row.errors)}</td>
                                        <td>{formatNumber(row.modelCount)}</td>
                                        <td>{row.avgLatency ? `${formatNumber(row.avgLatency)}ms` : '-'}</td>
                                        <td>{formatCurrency(row.cost)}</td>
                                    </tr>
                                )) : <tr><td colSpan="6" className="empty">No endpoint data</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="chart-card" style={{ margin: 0 }}>
                    <div className="chart-header"><h3>Model Statistics</h3></div>
                    <div className="table-wrapper">
                        <table className="data-table">
                            <thead><tr><th>Model</th><th>Provider</th><th>Requests</th><th>Errors</th><th>Tokens</th><th>Cost</th></tr></thead>
                            <tbody>
                                {modelRows.length ? modelRows.map(row => (
                                    <tr key={row.model}>
                                        <td title={row.model}>{compactText(row.model, 48)}</td>
                                        <td>{row.provider || '-'}</td>
                                        <td>{formatNumber(row.requests)}</td>
                                        <td>{formatNumber(row.errors)}</td>
                                        <td>{formatNumber(row.tokens)}</td>
                                        <td>{formatCurrency(row.cost)}</td>
                                    </tr>
                                )) : <tr><td colSpan="6" className="empty">No model data</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="chart-card chart-full">
                <div className="chart-header"><h3>Price Settings</h3></div>
                <div className="stat-meta">
                    Event cost is calculated by the collector from model pricing and persisted as estimated_cost_usd. Unknown models use the collector fallback pricing, so this panel remains read-only in Dashboard.
                </div>
            </div>

            <div className="chart-card chart-full">
                <div className="chart-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <h3>Request Events</h3>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="terminal-btn" onClick={clearFilters}>Clear Filters</button>
                            <button className="terminal-btn" onClick={handleExportCsv} disabled={filteredEvents.length === 0}>Export CSV</button>
                        </div>
                    </div>
                    <div className="terminal-toolbar" style={{ width: '100%', borderBottom: 'none', padding: 0 }}>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                            <select className="terminal-search" value={providerFilter} onChange={e => setProviderFilter(e.target.value)} style={{ width: 'auto', minWidth: '150px' }}>
                                <option value="all">All Providers</option>
                                {providers.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <select className="terminal-search" value={modelFilter} onChange={e => setModelFilter(e.target.value)} style={{ width: 'auto', minWidth: '150px' }}>
                                <option value="all">All Models</option>
                                {models.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <select className="terminal-search" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ width: 'auto', minWidth: '150px' }}>
                                <option value="all">All Sources</option>
                                {sources.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <select className="terminal-search" value={authFilter} onChange={e => setAuthFilter(e.target.value)} style={{ width: 'auto', minWidth: '150px' }}>
                                <option value="all">All Auth Indexes</option>
                                {auths.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                            <select className="terminal-search" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto', minWidth: '150px' }}>
                                <option value="all">All Statuses</option>
                                <option value="success">Success</option>
                                <option value="failure">Failure</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                {columns.map(col => (
                                    <th
                                        key={col.key}
                                        className={col.sortable ? 'sortable' : ''}
                                        onClick={col.sortable ? () => handleTableSort(col.key) : undefined}
                                    >
                                        {col.label}
                                        {col.sortable && <SortIcon column={col.key} />}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedEvents.length > 0 ? sortedEvents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r, idx) => (
                                <tr key={r.id || `event-${idx}`}>
                                    <td title={r.occurred_at}>{formatDateTime(r.occurred_at)}</td>
                                    <td>{r.model_name || '-'}</td>
                                    <td>{r.provider || inferProvider(r.api_endpoint, r.model_name)}</td>
                                    <td title={r.api_endpoint}>{r.api_endpoint || '-'}</td>
                                    <td title={r.source_id}>{r.source_id || '-'}</td>
                                    <td title={r.auth_index}>{r.auth_index || '-'}</td>
                                    <td>
                                        <span className={r.failed ? 'status-failure' : 'status-success'}>
                                            {r.failed ? 'FAILURE' : 'SUCCESS'}
                                        </span>
                                    </td>
                                    <td>{r.latency_ms ? `${formatNumber(r.latency_ms)}ms` : '-'}</td>
                                    <td>{formatNumber(r.input_tokens)}</td>
                                    <td>{formatNumber(r.output_tokens)}</td>
                                    <td>{formatNumber(r.reasoning_tokens)}</td>
                                    <td>{formatNumber(r.cached_tokens)}</td>
                                    <td>{formatNumber(r.total_tokens)}</td>
                                    <td>{formatCurrency(r.estimated_cost_usd)}</td>
                                </tr>
                            )) : (
                                <tr><td colSpan={columns.length} className="empty">No events found</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {filteredEvents.length > PAGE_SIZE && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '16px', borderTop: '1px solid var(--border)' }}>
                        <button className="terminal-btn" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
                        <span style={{ padding: '4px 8px', color: 'var(--text-dim)' }}>Page {page} of {Math.ceil(filteredEvents.length / PAGE_SIZE)}</span>
                        <button className="terminal-btn" disabled={page >= Math.ceil(filteredEvents.length / PAGE_SIZE)} onClick={() => setPage(p => Math.min(Math.ceil(filteredEvents.length / PAGE_SIZE), p + 1))}>Next</button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default RequestEventsPanel
