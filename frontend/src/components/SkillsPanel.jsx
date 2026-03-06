import { useMemo } from 'react'
import { AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { getModelColor } from '../lib/brandColors'

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

function SkillsPanel({ skillRuns = [], skillDailyStats = [], isDarkMode }) {
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
                        <h3>Top Skills by Runs</h3>
                    </div>
                    <div className="chart-body chart-body-dark">
                        {topSkills.length > 0 ? (
                            <ResponsiveContainer width="100%" height={Math.max(220, topSkills.length * 28)}>
                                <BarChart data={topSkills} layout="vertical" margin={{ left: 10, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'} horizontal={false} />
                                    <XAxis type="number" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis type="category" dataKey="skill_name" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} width={160} axisLine={false} tickLine={false} interval={0} />
                                    <Tooltip content={({ active, payload, label }) => {
                                        if (!active || !payload?.length) return null
                                        const item = payload[0].payload
                                        return (
                                            <div style={{ padding: '8px 10px', background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'white', border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`, borderRadius: 8 }}>
                                                <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                                                <div style={{ fontSize: 12 }}>Runs: {item.run_count.toLocaleString()}</div>
                                                <div style={{ fontSize: 12 }}>Tokens: {formatNumber(item.input_tokens + item.output_tokens)}</div>
                                                <div style={{ fontSize: 12 }}>Machines: {item.machines}</div>
                                                <div style={{ fontSize: 12, color: '#10b981' }}>Cost: {formatCost(item.estimated_cost)}</div>
                                            </div>
                                        )
                                    }} />
                                    <Bar dataKey="run_count" fill="url(#gradSkillRuns)" stroke="#8b5cf6" radius={[0, 6, 6, 0]}>
                                        {topSkills.map((entry, index) => (
                                            <Cell key={entry.skill_name} fill={getModelColor(entry.skill_name)} fillOpacity={0.85 - index * 0.01} />
                                        ))}
                                    </Bar>
                                    <defs>
                                        <linearGradient id="gradSkillRuns" x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                        </linearGradient>
                                    </defs>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
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
                                <th>Skill</th>
                                <th>Project</th>
                                <th>Machine</th>
                                <th>Triggered</th>
                                <th>Input Tokens</th>
                                <th>Output Tokens</th>
                                <th>Duration (ms)</th>
                                <th>Model</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentRuns.length > 0 ? recentRuns.map((r, idx) => (
                                <tr key={`${r.session_id}-${idx}`}>
                                    <td>{r.skill_name || 'Unknown'}</td>
                                    <td>{r.project_dir || '—'}</td>
                                    <td>{r.machine_id || '—'}</td>
                                    <td>{r.triggered_at ? new Date(r.triggered_at).toLocaleString() : '—'}</td>
                                    <td>{formatNumber(r.tokens_used || 0)}</td>
                                    <td>{formatNumber(r.output_tokens || 0)}</td>
                                    <td>{formatNumber(r.duration_ms || 0)}</td>
                                    <td>{r.model || '—'}</td>
                                </tr>
                            )) : (
                                <tr><td colSpan="8" className="empty">No runs synced yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

export default SkillsPanel
