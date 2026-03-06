import { useMemo, useState } from 'react'
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CHART_COLORS } from '../lib/brandColors'

const formatNumber = (num) => {
    if (num === undefined || num === null) return '0'
    return Math.round(num).toLocaleString('en-US')
}

const formatCost = (cost) => {
    if (!cost) return '$0'
    return cost < 1 ? `$${cost.toFixed(2)}` : `$${cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

const estimateCost = (inputTokens, outputTokens) => {
    return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15
}

const RECENT_COLUMNS = [
    { key: 'skill_name', label: 'Skill', sortable: true, getValue: r => r.skill_name || '' },
    { key: 'project_dir', label: 'Project', sortable: true, getValue: r => r.project_dir || '' },
    { key: 'machine_id', label: 'Machine', sortable: true, getValue: r => r.machine_id || '' },
    { key: 'triggered_at', label: 'Triggered', sortable: true, getValue: r => r.triggered_at || '' },
    { key: 'tokens_used', label: 'Input Tokens', sortable: true, getValue: r => r.tokens_used || 0 },
    { key: 'output_tokens', label: 'Output Tokens', sortable: true, getValue: r => r.output_tokens || 0 },
    { key: 'duration_ms', label: 'Duration', sortable: true, getValue: r => r.duration_ms || 0 },
    { key: 'model', label: 'Model', sortable: true, getValue: r => r.model || '' },
]

function SortIcon({ column, sortCol, sortDir }) {
    if (column !== sortCol) return <span className="sort-icon"> ↕</span>
    return <span className="sort-icon active">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
}

function SkillsPanel({ skillRuns = [], skillDailyStats = [], isDarkMode }) {
    const [skillSort, setSkillSort] = useState('runs')
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
        estimatedCost,
        topSkills,
        dailySeries,
        recentRuns,
    } = useMemo(() => {
        const runs = Array.isArray(skillRuns) ? skillRuns : []
        const daily = Array.isArray(skillDailyStats) ? skillDailyStats : []

        const totalInputTokens = runs.reduce((sum, r) => sum + (r.tokens_used || 0), 0)
        const totalOutputTokens = runs.reduce((sum, r) => sum + (r.output_tokens || 0), 0)

        const skillsMap = new Map()
        for (const r of runs) {
            const key = r.skill_name || 'unknown'
            if (!skillsMap.has(key)) {
                skillsMap.set(key, {
                    skill_name: key,
                    run_count: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    machines: new Set(),
                })
            }
            const row = skillsMap.get(key)
            row.run_count += 1
            row.input_tokens += r.tokens_used || 0
            row.output_tokens += r.output_tokens || 0
            if (r.machine_id) row.machines.add(r.machine_id)
        }

        const topSkills = Array.from(skillsMap.values())
            .map(s => ({
                ...s,
                machines: s.machines.size,
                estimated_cost: estimateCost(s.input_tokens, s.output_tokens)
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
                    input_tokens: 0,
                    output_tokens: 0,
                })
            }
            const row = dailyAgg.get(key)
            row.run_count += d.run_count || 0
            row.input_tokens += d.total_tokens || 0
            row.output_tokens += d.total_output_tokens || 0
        }

        const dailySeries = Array.from(dailyAgg.values())
            .sort((a, b) => a.stat_date.localeCompare(b.stat_date))
            .map(row => ({
                ...row,
                estimated_cost: estimateCost(row.input_tokens, row.output_tokens),
                label: row.stat_date?.slice(5) || row.stat_date,
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
            estimatedCost: estimateCost(totalInputTokens, totalOutputTokens),
            topSkills,
            dailySeries,
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

    const renderCell = (r, key) => {
        switch (key) {
            case 'skill_name': return r.skill_name || 'Unknown'
            case 'project_dir': return r.project_dir || '—'
            case 'machine_id': return r.machine_id || '—'
            case 'triggered_at': return r.triggered_at ? new Date(r.triggered_at).toLocaleString() : '—'
            case 'tokens_used': return formatNumber(r.tokens_used || 0)
            case 'output_tokens': return formatNumber(r.output_tokens || 0)
            case 'duration_ms': return r.duration_ms ? `${formatNumber(r.duration_ms)}ms` : '—'
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
                    <div className="stat-header"><span className="stat-label">TOKENS (OUTPUT)</span></div>
                    <div className="stat-value">{formatNumber(totalOutputTokens)}</div>
                    <div className="stat-meta">{totalRuns > 0 ? formatNumber(Math.round(totalOutputTokens / totalRuns)) : '0'} / run</div>
                </div>
                <div className="stat-card">
                    <div className="stat-header"><span className="stat-label">EST. COST</span></div>
                    <div className="stat-value"><span className="cost-value">{formatCost(estimatedCost)}</span></div>
                    <div className="stat-meta">$3 / 1M input · $15 / 1M output</div>
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
                        <h3>Token Usage Over Time</h3>
                    </div>
                    <div className="chart-body chart-body-dark">
                        {dailySeries.length > 0 ? (
                            <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={dailySeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="gradSkillTokens" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="4 4" stroke={isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />
                                    <XAxis dataKey="label" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v.toLocaleString()} />
                                    <Tooltip content={({ active, payload, label }) => {
                                        if (!active || !payload?.length) return null
                                        const item = payload[0].payload
                                        return (
                                            <div style={{ padding: '8px 10px', background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'white', border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`, borderRadius: 8 }}>
                                                <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                                                <div style={{ fontSize: 12 }}>Runs: {item.run_count.toLocaleString()}</div>
                                                <div style={{ fontSize: 12 }}>Input: {formatNumber(item.input_tokens)}</div>
                                                <div style={{ fontSize: 12 }}>Output: {formatNumber(item.output_tokens)}</div>
                                                <div style={{ fontSize: 12, color: '#10b981' }}>Cost: {formatCost(item.estimated_cost)}</div>
                                            </div>
                                        )
                                    }} />
                                    <Area type="monotone" dataKey="input_tokens" name="Input" stroke="#3b82f6" fill="url(#gradSkillTokens)" strokeWidth={2} />
                                    <Area type="monotone" dataKey="output_tokens" name="Output" stroke="#8b5cf6" fillOpacity={0.2} fill="#8b5cf6" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="empty-state">No daily stats yet</div>
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
