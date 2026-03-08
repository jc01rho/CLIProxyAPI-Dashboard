import { useEffect, useMemo, useState } from 'react'

const PAGE_SIZE = 500
const COPY_MAX_ROWS = 300
const COPY_MAX_CHARS = 30000
const SEVERITY_OPTIONS = ['all', 'debug', 'info', 'warn', 'error']

const formatTime = (iso) => {
    if (!iso) return '--:--:--'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '--:--:--'
    return d.toLocaleTimeString('en-GB', { hour12: false })
}

const formatDateTime = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString()
}

const toSafeString = (value) => {
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

const redactSensitive = (text) => {
    if (!text) return ''
    let out = text
    out = out.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED]')
    out = out.replace(/\bsk-[A-Za-z0-9\-_]{10,}\b/g, 'sk-[REDACTED]')
    out = out.replace(/\bghp_[A-Za-z0-9]{10,}\b/g, 'ghp_[REDACTED]')
    out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, 'github_pat_[REDACTED]')
    out = out.replace(/("?(authorization|apikey|api_key|secret|token)"?\s*[:=]\s*")(.*?)(")/gi, '$1[REDACTED]$4')
    out = out.replace(/((authorization|apikey|api_key|secret|token)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    return out
}

function LogViewerPanel({ appLogs = [], skillRuns = [], dateRange, customRange }) {
    const [severityFilter, setSeverityFilter] = useState('all')
    const [searchText, setSearchText] = useState('')
    const [paused, setPaused] = useState(false)
    const [frozenLogs, setFrozenLogs] = useState([])
    const [selectedIds, setSelectedIds] = useState(new Set())

    const mergedLogs = useMemo(() => {
        const fromAppLogs = (Array.isArray(appLogs) ? appLogs : []).map((row) => ({
            id: `app-${row.id ?? row.event_uid ?? Math.random()}`,
            time: row.logged_at,
            severity: (row.severity || 'info').toLowerCase(),
            category: (row.category || 'system').toLowerCase(),
            source: row.source || 'collector',
            title: row.title || '',
            message: row.message || '',
            context: [row.session_id, row.machine_id, row.project_dir].filter(Boolean).join(' · '),
            details: toSafeString(row.details),
        }))

        const fromSkillRuns = (Array.isArray(skillRuns) ? skillRuns : []).map((row, idx) => {
            const status = (row.status || 'success').toLowerCase()
            const severity = status === 'failure' ? 'warn' : 'info'
            const message = status === 'failure'
                ? (row.error_message || `Skill run failed: ${row.skill_name || 'unknown skill'}`)
                : `Skill run succeeded: ${row.skill_name || 'unknown skill'}`

            return {
                id: `skill-${row.event_uid || row.tool_use_id || row.session_id || idx}`,
                time: row.triggered_at,
                severity,
                category: 'skill',
                source: row.source || 'skill-tracker',
                title: row.skill_name || 'Skill event',
                message,
                context: [row.session_id, row.machine_id, row.project_dir, row.model].filter(Boolean).join(' · '),
                details: toSafeString({
                    status: row.status,
                    tokens_used: row.tokens_used,
                    output_tokens: row.output_tokens,
                    duration_ms: row.duration_ms,
                    tool_calls: row.tool_calls,
                    estimated_cost_usd: row.estimated_cost_usd,
                    error_type: row.error_type,
                }),
            }
        })

        return [...fromAppLogs, ...fromSkillRuns]
            .sort((a, b) => new Date(b.time) - new Date(a.time))
    }, [appLogs, skillRuns])

    useEffect(() => {
        if (!paused) {
            setFrozenLogs(mergedLogs)
        }
    }, [mergedLogs, paused])

    const displayLogs = paused ? frozenLogs : mergedLogs

    const filteredLogs = useMemo(() => {
        const q = searchText.trim().toLowerCase()
        return displayLogs.filter((r) => {
            if (severityFilter !== 'all' && r.severity !== severityFilter) return false
            if (!q) return true
            const hay = `${r.title} ${r.message} ${r.context} ${r.details} ${r.source} ${r.category}`.toLowerCase()
            return hay.includes(q)
        })
    }, [displayLogs, severityFilter, searchText])

    const visibleLogs = useMemo(() => filteredLogs.slice(0, PAGE_SIZE), [filteredLogs])

    const summary = useMemo(() => {
        const bySeverity = {}
        for (const row of filteredLogs) {
            bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1
        }
        return { bySeverity }
    }, [filteredLogs])

    const selectedRows = useMemo(() => filteredLogs.filter(r => selectedIds.has(r.id)), [filteredLogs, selectedIds])

    const toggleSelected = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const clearView = () => {
        setSeverityFilter('all')
        setSearchText('')
        setSelectedIds(new Set())
    }

    const buildCopyPayload = (rows, modeLabel) => {
        const selected = rows.slice(0, COPY_MAX_ROWS)
        const filterContext = {
            dateRange,
            customRange,
            severity: severityFilter,
            search: searchText || '',
            paused,
            totalFiltered: filteredLogs.length,
            copiedRows: selected.length,
        }

        const lines = []
        lines.push('=== AI DEBUG LOG CONTEXT ===')
        lines.push(`Mode: ${modeLabel}`)
        lines.push(`Context: ${redactSensitive(toSafeString(filterContext))}`)
        lines.push('Summary by severity:')
        Object.entries(summary.bySeverity).forEach(([k, v]) => lines.push(`- ${k}: ${v}`))
        lines.push('')
        lines.push('Logs:')

        for (const row of selected) {
            lines.push(`[${formatDateTime(row.time)}] [${row.severity}] [${row.category}] [${row.source}] ${redactSensitive(row.title || '-')}`)
            lines.push(`Message: ${redactSensitive(row.message || '-')}`)
            if (row.context) lines.push(`Context: ${redactSensitive(row.context)}`)
            if (row.details) lines.push(`Details:\n${redactSensitive(row.details)}`)
            lines.push('---')
        }

        let text = lines.join('\n')
        if (text.length > COPY_MAX_CHARS) text = `${text.slice(0, COPY_MAX_CHARS)}\n...[TRUNCATED]`
        return text
    }

    const copyText = async (text) => {
        try { await navigator.clipboard.writeText(text) } catch { /* no-op */ }
    }

    return (
        <div className="skills-panel log-viewer-panel">
            <div className="terminal-log-shell">
                <div className="terminal-toolbar">
                    <div className="severity-chips">
                        {SEVERITY_OPTIONS.map((s) => (
                            <button
                                key={s}
                                className={`sev-chip ${severityFilter === s ? 'active' : ''}`}
                                onClick={() => setSeverityFilter(s)}
                            >
                                {s.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    <input
                        className="terminal-search"
                        type="text"
                        placeholder="Search logs..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                    />

                    <div className="terminal-actions">
                        <button className="terminal-btn" onClick={() => setPaused(v => !v)}>{paused ? 'Resume' : 'Pause'}</button>
                        <button className="terminal-btn" onClick={clearView}>Clear</button>
                        <button className="terminal-btn" onClick={() => copyText(buildCopyPayload(selectedRows, 'selected'))}>Copy Selected</button>
                        <button className="terminal-btn" onClick={() => copyText(buildCopyPayload(filteredLogs, 'top-filtered'))}>Copy Filtered</button>
                        <div className="live-state"><span className="dot" />{paused ? 'Paused' : 'Live'} · {filteredLogs.length} entries</div>
                    </div>
                </div>

                <div className="terminal-window">
                    <div className="terminal-header">
                        <div className="traffic-lights"><span /><span /><span /></div>
                        <div className="terminal-title">log-viewer</div>
                    </div>

                    <div className="terminal-lines">
                        {visibleLogs.length > 0 ? visibleLogs.map((r) => {
                            const line = `${r.source} → ${r.title ? `${r.title} · ` : ''}${r.message}${r.context ? ` · ${r.context}` : ''}`
                            return (
                                <button
                                    key={r.id}
                                    className={`terminal-line ${selectedIds.has(r.id) ? 'selected' : ''}`}
                                    onClick={() => toggleSelected(r.id)}
                                >
                                    <span className="line-time">{formatTime(r.time)}</span>
                                    <span className={`line-sev sev-${r.severity}`}>{r.severity.toUpperCase()}</span>
                                    <span className="line-msg">{line}</span>
                                </button>
                            )
                        }) : (
                            <div className="terminal-empty">No logs found in this range</div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}

export default LogViewerPanel
