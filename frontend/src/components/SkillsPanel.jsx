import { useEffect, useMemo, useState } from 'react'
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CHART_COLORS, CHART_TYPOGRAPHY } from '../lib/brandColors'

const formatNumber = (num) => {
    if (num === undefined || num === null) return '0'
    return Math.round(num).toLocaleString('en-US')
}

const formatCost = (cost) => {
    if (!cost) return '$0'
    return cost < 1 ? `$${cost.toFixed(2)}` : `$${cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}


const RECENT_COLUMNS = [
    { key: 'skill_name', label: 'Skill', sortable: true, getValue: r => r.skill_name || '' },
    { key: 'project_dir', label: 'Project', sortable: true, getValue: r => r.project_dir || '' },
    { key: 'machine_id', label: 'Machine', sortable: true, getValue: r => r.machine_id || '' },
    { key: 'triggered_at', label: 'Triggered', sortable: true, getValue: r => r.triggered_at || '' },
    { key: 'tokens_used', label: 'Input Tokens', sortable: true, getValue: r => r.tokens_used || 0 },
    { key: 'output_tokens', label: 'Output Tokens', sortable: true, getValue: r => r.output_tokens || 0 },
    { key: 'duration_ms', label: 'Duration', sortable: true, getValue: r => r.duration_ms || 0 },
    { key: 'status', label: 'Status', sortable: true, getValue: r => r.status || '' },
    { key: 'attempt_no', label: 'Attempt', sortable: true, getValue: r => r.attempt_no || 1 },
    { key: 'estimated_cost_usd', label: 'Cost', sortable: true, getValue: r => r.estimated_cost_usd || 0 },
    { key: 'error_message', label: 'Error', sortable: true, getValue: r => r.error_message || '' },
    { key: 'model', label: 'Model', sortable: true, getValue: r => r.model || '' },
]

function SortIcon({ column, sortCol, sortDir }) {
    if (column !== sortCol) return <span className="sort-icon"> ↕</span>
    return <span className="sort-icon active">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
}

function SkillsPanel({ skillRuns = [], skillDailyStats = [], dateRange, customRange, isDarkMode }) {
    const [skillSort, setSkillSort] = useState('runs')
    const [trendTime, setTrendTime] = useState('day')
    const [tableSortCol, setTableSortCol] = useState('triggered_at')
    const [tableSortDir, setTableSortDir] = useState('desc')

    const handleTableSort = (key) => {
        if (tableSortCol === key) {
            setTableSortDir(d => d === 'desc' ? 'asc' : 'desc')
        } else {
            setTableSortCol(key)
            setTableSortDir('desc')
        }
    }

    const {
        totalRuns,
        uniqueSkills,
        uniqueMachines,
        uniqueProjects,
        totalInputTokens,
        totalOutputTokens,
        totalCost,
        successCount,
        failureCount,
        successRate,
        topSkills,
        dailySeries,
        hourlySeries,
        recentRuns,
    } = useMemo(() => {
        const runs = Array.isArray(skillRuns) ? skillRuns : []
        const daily = Array.isArray(skillDailyStats) ? skillDailyStats : []

        const totalInputTokens = runs.reduce((sum, r) => sum + (r.tokens_used || 0), 0)
        const totalOutputTokens = runs.reduce((sum, r) => sum + (r.output_tokens || 0), 0)
        const totalCost = runs.reduce((sum, r) => sum + (Number(r.estimated_cost_usd || 0)), 0)
        const successCount = runs.filter(r => (r.status || 'success') === 'success').length
        const failureCount = Math.max(0, runs.length - successCount)
        const successRate = runs.length > 0 ? (successCount / runs.length) * 100 : 0

        const skillsMap = new Map()
        for (const r of runs) {
            const key = r.skill_name || 'unknown'
            if (!skillsMap.has(key)) {
                skillsMap.set(key, {
                    skill_name: key,
                    run_count: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    estimated_cost: 0,
                    machines: new Set(),
                })
            }
            const row = skillsMap.get(key)
            row.run_count += 1
            row.input_tokens += r.tokens_used || 0
            row.output_tokens += r.output_tokens || 0
            row.estimated_cost += Number(r.estimated_cost_usd || 0)
            if (r.machine_id) row.machines.add(r.machine_id)
        }

        const topSkills = Array.from(skillsMap.values())
            .map(s => ({
                ...s,
                machines: s.machines.size,
                estimated_cost: s.estimated_cost || 0
            }))
            .sort((a, b) => (b.run_count - a.run_count) || (b.input_tokens - a.input_tokens))
            .slice(0, 15)

        const dailyAgg = new Map()
        for (const d of daily) {
            const key = d.stat_date
            if (!dailyAgg.has(key)) {
                dailyAgg.set(key, {
                    stat_date: key,
                    run_count: 0,
                    success_count: 0,
                    failure_count: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tool_calls: 0,
                    total_cost_usd: 0,
                })
            }
            const row = dailyAgg.get(key)
            row.run_count += d.run_count || 0
            row.success_count += d.success_count || 0
            row.failure_count += d.failure_count || 0
            row.input_tokens += d.total_tokens || 0
            row.output_tokens += d.total_output_tokens || 0
            row.total_tool_calls += d.total_tool_calls || 0
            row.total_cost_usd += Number(d.total_cost_usd || 0)
        }

        // Fallback: build daily series from raw runs when skill_daily_stats is empty
        if (dailyAgg.size === 0) {
            for (const r of runs) {
                if (!r.triggered_at) continue
                const dt = new Date(r.triggered_at)
                if (Number.isNaN(dt.getTime())) continue
                const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
                if (!dailyAgg.has(key)) {
                    dailyAgg.set(key, {
                        stat_date: key,
                        run_count: 0,
                        success_count: 0,
                        failure_count: 0,
                        input_tokens: 0,
                        output_tokens: 0,
                        total_tool_calls: 0,
                        total_cost_usd: 0,
                    })
                }
                const row = dailyAgg.get(key)
                row.run_count += 1
                row.success_count += (r.status || 'success') === 'success' ? 1 : 0
                row.failure_count += (r.status || 'success') === 'failure' ? 1 : 0
                row.input_tokens += r.tokens_used || 0
                row.output_tokens += r.output_tokens || 0
                row.total_tool_calls += r.tool_calls || 0
                row.total_cost_usd += Number(r.estimated_cost_usd || 0)
            }
        }

        const dailySeries = Array.from(dailyAgg.values())
            .sort((a, b) => a.stat_date.localeCompare(b.stat_date))
            .map(row => ({
                ...row,
                estimated_cost: Number(row.total_cost_usd || 0),
                label: row.stat_date?.slice(5) || row.stat_date,
            }))

        const hourlyAgg = new Map()
        for (const r of runs) {
            if (!r.triggered_at) continue
            const dt = new Date(r.triggered_at)
            if (Number.isNaN(dt.getTime())) continue
            const hourLabel = `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:00`
            if (!hourlyAgg.has(hourLabel)) {
                hourlyAgg.set(hourLabel, {
                    label: hourLabel,
                    run_count: 0,
                    success_count: 0,
                    failure_count: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tool_calls: 0,
                    total_cost_usd: 0,
                    _ts: dt.getTime() - (dt.getMinutes() * 60 + dt.getSeconds()) * 1000,
                })
            }
            const row = hourlyAgg.get(hourLabel)
            row.run_count += 1
            row.success_count += (r.status || 'success') === 'success' ? 1 : 0
            row.failure_count += (r.status || 'success') === 'failure' ? 1 : 0
            row.input_tokens += r.tokens_used || 0
            row.output_tokens += r.output_tokens || 0
            row.total_tool_calls += r.tool_calls || 0
            row.total_cost_usd += Number(r.estimated_cost_usd || 0)
        }

        const hourlySeries = Array.from(hourlyAgg.values())
            .sort((a, b) => a._ts - b._ts)
            .map(row => ({
                label: row.label,
                run_count: row.run_count,
                success_count: row.success_count,
                failure_count: row.failure_count,
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                total_tool_calls: row.total_tool_calls,
                estimated_cost: Number(row.total_cost_usd || 0),
            }))

        const recentRuns = runs
            .slice()
            .sort((a, b) => new Date(b.triggered_at) - new Date(a.triggered_at))
            .slice(0, 50)

        return {
            totalRuns: runs.length,
            uniqueSkills: new Set(runs.map(r => r.skill_name)).size,
            uniqueMachines: new Set(runs.map(r => r.machine_id).filter(Boolean)).size,
            uniqueProjects: new Set(runs.map(r => r.project_dir).filter(Boolean)).size,
            totalInputTokens,
            totalOutputTokens,
            totalCost,
            successCount,
            failureCount,
            successRate,
            topSkills,
            dailySeries,
            hourlySeries,
            recentRuns,
        }
    }, [skillRuns, skillDailyStats])

    const sortedSkills = useMemo(() => {
        return topSkills.map(s => {
            const _sortValue = skillSort === 'tokens' ? s.input_tokens + s.output_tokens
                : skillSort === 'cost' ? s.estimated_cost
                : s.run_count
            return { ...s, _sortValue }
        }).sort((a, b) => b._sortValue - a._sortValue)
    }, [topSkills, skillSort])

    const sortedRecentRuns = useMemo(() => {
        const col = RECENT_COLUMNS.find(c => c.key === tableSortCol)
        if (!col) return recentRuns
        return [...recentRuns].sort((a, b) => {
            const va = col.getValue(a)
            const vb = col.getValue(b)
            const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))
            return tableSortDir === 'asc' ? cmp : -cmp
        })
    }, [recentRuns, tableSortCol, tableSortDir])

    useEffect(() => {
        const isCustomSingleDay = dateRange === 'custom'
            && customRange?.startDate
            && customRange?.endDate
            && customRange.startDate === customRange.endDate

        const isSingleDayRange = dateRange === 'today' || dateRange === 'yesterday' || isCustomSingleDay

        if (isSingleDayRange) {
            if (trendTime !== 'hour') {
                setTrendTime('hour')
            }
            return
        }

        // Multi-day ranges should default to day view
        if (trendTime !== 'day' && dailySeries.length > 0) {
            setTrendTime('day')
            return
        }

        // If day view has no points, fallback to hour view
        if (dailySeries.length === 0 && hourlySeries.length > 0) {
            setTrendTime('hour')
        }
    }, [dateRange, customRange, trendTime, dailySeries.length, hourlySeries.length])

    const trendSeries = trendTime === 'hour' ? hourlySeries : dailySeries
    const hasTokenSignal = trendSeries.some(p => (p.input_tokens || 0) > 0 || (p.output_tokens || 0) > 0)
    const useRunFallbackSeries = trendSeries.length > 0 && !hasTokenSignal

    const isCustomSingleDay = dateRange === 'custom'
            && customRange?.startDate
            && customRange?.endDate
            && customRange.startDate === customRange.endDate
    const isSingleDayRange = dateRange === 'today' || dateRange === 'yesterday' || isCustomSingleDay

    const renderCell = (r, key) => {
        switch (key) {
            case 'skill_name': return r.skill_name || 'Unknown'
            case 'project_dir': return r.project_dir || '—'
            case 'machine_id': return r.machine_id || '—'
            case 'triggered_at': return r.triggered_at ? new Date(r.triggered_at).toLocaleString() : '—'
            case 'tokens_used': return formatNumber(r.tokens_used || 0)
            case 'output_tokens': return formatNumber(r.output_tokens || 0)
            case 'duration_ms': return r.duration_ms ? `${formatNumber(r.duration_ms)}ms` : '—'
            case 'status': return r.status === 'failure' ? 'FAILURE' : 'SUCCESS'
            case 'attempt_no': return formatNumber(r.attempt_no || 1)
            case 'estimated_cost_usd': return formatCost(Number(r.estimated_cost_usd || 0))
            case 'error_message': {
                const msg = r.error_message || ''
                return msg ? (msg.length > 80 ? `${msg.slice(0, 80)}…` : msg) : '—'
            }
            case 'model': return r.model || '—'
            default: return '—'
        }
    }

    return (
        <div className="skills-panel">
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">TOTAL RUNS</span></div>
                    <div className="stat-value">{formatNumber(totalRuns)}</div>
                    <div className="stat-meta">{uniqueSkills} skills · {uniqueMachines} machines · {uniqueProjects} projects</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">TOKENS (INPUT)</span></div>
                    <div className="stat-value">{formatNumber(totalInputTokens)}</div>
                    <div className="stat-meta">Avg {totalRuns > 0 ? formatNumber(Math.round(totalInputTokens / totalRuns)) : '0'} / run</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">SUCCESS RATE</span></div>
                    <div className="stat-value">{successRate.toFixed(1)}%</div>
                    <div className="stat-meta">{formatNumber(successCount)} success · {formatNumber(failureCount)} failures</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">TOTAL COST</span></div>
                    <div className="stat-value"><span className="cost-value">{formatCost(totalCost)}</span></div>
                    <div className="stat-meta">Average {formatCost(totalRuns > 0 ? totalCost / totalRuns : 0)} / run</div>
                </div>
            </div>

            <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Top Skills</h3>
                        <div className="chart-tabs">
                            {[['runs', 'Runs'], ['tokens', 'Tokens'], ['cost', 'Cost']].map(([key, label]) => (
                                <button
                                    key={key}
                                    className={`tab${skillSort === key ? ' active' : ''}`}
                                    onClick={() => setSkillSort(key)}
                                >{label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="skill-ranked-list">
                        {sortedSkills.length > 0 ? sortedSkills.map((s, i) => {
                            const maxVal = sortedSkills[0]._sortValue
                            const pct = maxVal > 0 ? (s._sortValue / maxVal) * 100 : 0
                            const color = CHART_COLORS[i % CHART_COLORS.length]
                            return (
                                <div key={s.skill_name} className="skill-rank-row">
                                    <span className="skill-rank-num" style={{ color }}>{i + 1}</span>
                                    <div className="skill-rank-body">
                                        <div className="skill-rank-top">
                                            <span className="skill-rank-name">{s.skill_name}</span>
                                            <span className="skill-rank-stats">
                                                <span className="skill-stat-pill">{s.run_count} runs</span>
                                                <span className="skill-stat-pill">{formatNumber(s.input_tokens + s.output_tokens)} tok</span>
                                                <span className="skill-stat-pill cost">{formatCost(s.estimated_cost)}</span>
                                            </span>
                                        </div>
                                        <div className="skill-rank-bar-track">
                                            <div className="skill-rank-bar-fill" style={{ width: `${pct}%`, background: color }} />
                                        </div>
                                    </div>
                                </div>
                            )
                        }) : (
                            <div className="empty-state">No skill runs found</div>
                        )}
                    </div>
                </div>
            </div>

            <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Skill Funnel & Token Usage Over Time</h3>
                    </div>
                    <div className="chart-body chart-body-dark">
                        {trendSeries.length > 0 ? (
                            <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={trendSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="gradSkillTokens" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="4 4" stroke={isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />
                                    <XAxis dataKey="label" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={CHART_TYPOGRAPHY.axisTick} axisLine={false} tickLine={false} />
                                    <YAxis stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={CHART_TYPOGRAPHY.axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v.toLocaleString()} />
                                    <Tooltip content={({ active, payload, label }) => {
                                        if (!active || !payload?.length) return null
                                        const item = payload[0].payload
                                        return (
                                            <div style={{ padding: '8px 10px', background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'white', border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`, borderRadius: 8 }}>
                                                <div style={{ ...CHART_TYPOGRAPHY.tooltipLabel, marginBottom: 4 }}>{label}</div>
                                                <div style={CHART_TYPOGRAPHY.tooltipItem}>Attempts: {(item.run_count || 0).toLocaleString()}</div>
                                                <div style={CHART_TYPOGRAPHY.tooltipItem}>Success: {(item.success_count || 0).toLocaleString()}</div>
                                                <div style={CHART_TYPOGRAPHY.tooltipItem}>Failure: {(item.failure_count || 0).toLocaleString()}</div>
                                                <div style={CHART_TYPOGRAPHY.tooltipItem}>Input: {formatNumber(item.input_tokens)}</div>
                                                <div style={CHART_TYPOGRAPHY.tooltipItem}>Output: {formatNumber(item.output_tokens)}</div>
                                                {useRunFallbackSeries && <div style={CHART_TYPOGRAPHY.tooltipItem}>Runs: {formatNumber(item.run_count)}</div>}
                                                <div style={{ ...CHART_TYPOGRAPHY.tooltipItem, color: '#10b981' }}>Cost: {formatCost(item.estimated_cost)}</div>
                                            </div>
                                        )
                                    }} />
                                    {useRunFallbackSeries ? (
                                        <Area type="monotone" dataKey="run_count" name="Runs" stroke="#f59e0b" fillOpacity={0.25} fill="#f59e0b" strokeWidth={2} />
                                    ) : (
                                        <>
                                            <Area type="monotone" dataKey="input_tokens" name="Input" stroke="#3b82f6" fill="url(#gradSkillTokens)" strokeWidth={2} />
                                            <Area type="monotone" dataKey="output_tokens" name="Output" stroke="#8b5cf6" fillOpacity={0.2} fill="#8b5cf6" strokeWidth={2} />
                                        </>
                                    )}
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="empty-state">No {trendTime}ly stats yet</div>
                        )}
                    </div>
                </div>
            </div>

            <div className="chart-card chart-full">
                <div className="chart-header">
                    <h3>Recent Runs</h3>
                </div>
                <div className="table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                {RECENT_COLUMNS.map(col => (
                                    <th
                                        key={col.key}
                                        className={col.sortable ? 'sortable' : ''}
                                        onClick={col.sortable ? () => handleTableSort(col.key) : undefined}
                                    >
                                        {col.label}
                                        {col.sortable && <SortIcon column={col.key} sortCol={tableSortCol} sortDir={tableSortDir} />}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRecentRuns.length > 0 ? sortedRecentRuns.map((r, idx) => (
                                <tr key={`${r.session_id}-${idx}`}>
                                    {RECENT_COLUMNS.map(col => (
                                        <td key={col.key}>{renderCell(r, col.key)}</td>
                                    ))}
                                </tr>
                            )) : (
                                <tr><td colSpan={RECENT_COLUMNS.length} className="empty">No runs synced yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

export default SkillsPanel
