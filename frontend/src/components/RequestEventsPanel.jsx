import { useMemo, useState } from 'react'

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

const getStatus = (failed) => failed ? 'failure' : 'success'

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
    const [tableSortCol, setTableSortCol] = useState('occurred_at')
    const [tableSortDir, setTableSortDir] = useState('desc')

    const baseEvents = useMemo(() => Array.isArray(requestEvents) ? requestEvents : [], [requestEvents])

    const { models, sources, auths } = useMemo(() => {
        const m = new Set()
        const s = new Set()
        const a = new Set()
        for (const ev of baseEvents) {
            if (ev.model_name) m.add(ev.model_name)
            if (ev.source_id) s.add(ev.source_id)
            if (ev.auth_index) a.add(ev.auth_index)
        }
        return {
            models: Array.from(m).sort(),
            sources: Array.from(s).sort(),
            auths: Array.from(a).sort()
        }
    }, [baseEvents])

    const filteredEvents = useMemo(() => {
        return baseEvents.filter(ev => {
            if (modelFilter !== 'all' && ev.model_name !== modelFilter) return false
            if (sourceFilter !== 'all' && ev.source_id !== sourceFilter) return false
            if (authFilter !== 'all' && ev.auth_index !== authFilter) return false
            if (statusFilter !== 'all') {
                const isFailure = !!ev.failed
                if (statusFilter === 'success' && isFailure) return false
                if (statusFilter === 'failure' && !isFailure) return false
            }
            return true
        })
    }, [baseEvents, modelFilter, sourceFilter, authFilter, statusFilter])

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

        for (const ev of filteredEvents) {
            const lat = Number(ev.latency_ms) || 0
            if (lat > 0) {
                totalLatency += lat
                if (lat > maxLatency) maxLatency = lat
                count++
            }
            if (ev.failed) failures++
            else successes++
        }

        return {
            avgLatency: count > 0 ? Math.round(totalLatency / count) : 0,
            maxLatency,
            sampleCount: count,
            successes,
            failures,
            total: filteredEvents.length
        }
    }, [filteredEvents])

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
    ]

    return (
        <div className="skills-panel">
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">EVENTS</span></div>
                    <div className="stat-value">{formatNumber(summary.total)}</div>
                    <div className="stat-meta">{formatNumber(summary.successes)} success · {formatNumber(summary.failures)} failure</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">AVG LATENCY</span></div>
                    <div className="stat-value">{formatNumber(summary.avgLatency)} ms</div>
                    <div className="stat-meta">From {formatNumber(summary.sampleCount)} samples</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">MAX LATENCY</span></div>
                    <div className="stat-value">{formatNumber(summary.maxLatency)} ms</div>
                    <div className="stat-meta">Peak recorded delay</div>
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
                            {sortedEvents.length > 0 ? sortedEvents.slice(0, PAGE_SIZE).map((r, idx) => (
                                <tr key={r.id || `event-${idx}`}>
                                    <td title={r.occurred_at}>{formatDateTime(r.occurred_at)}</td>
                                    <td>{r.model_name || '-'}</td>
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
                                </tr>
                            )) : (
                                <tr><td colSpan={columns.length} className="empty">No events found</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

export default RequestEventsPanel
