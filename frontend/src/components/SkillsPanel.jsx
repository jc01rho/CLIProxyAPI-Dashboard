import { useEffect, useMemo, useState } from 'react'
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Bar, Line } from 'recharts'
import { selectRows } from '../lib/postgrest'
import { CHART_COLORS, CHART_TYPOGRAPHY } from '../lib/brandColors'
import ChartDialog from './ChartDialog'
import DrilldownPanel from './DrilldownPanel'

const formatNumber = (num) => {
    if (num === undefined || num === null) return '0'
    return Math.round(num).toLocaleString('en-US')
}

const formatCost = (cost) => {
    if (!cost) return '$0'
    return cost < 1 ? `$${cost.toFixed(2)}` : `$${cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`

const formatTpr = (value) => {
    if (value === undefined || value === null || Number.isNaN(value)) return '0.0'
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

const formatTprAxis = (value) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
    return Math.round(value).toLocaleString('en-US')
}

const SERIES_COLORS = {
    requests: '#8b5cf6',
    input: 'var(--color-info)',
    output: 'var(--color-cyan)',
    cost: 'var(--color-success)',
}

const getStatus = (status) => status === 'failure' ? 'failure' : 'success'
const getSkillLabel = (value) => value || 'Unknown'
const getProjectLabel = (value) => value || 'Unknown Project'
const getMachineLabel = (value) => value || 'Unknown Device'
const getModelLabel = (value) => value || 'Unknown Model'

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

const createEmptySeriesRow = (label, extra = {}) => ({
    label,
    run_count: 0,
    success_count: 0,
    failure_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tool_calls: 0,
    estimated_cost: 0,
    ...extra,
})

const buildSeriesFromRuns = (runs, granularity) => {
    const seriesMap = new Map()

    for (const run of runs) {
        if (!run.triggered_at) continue
        const dt = new Date(run.triggered_at)
        if (Number.isNaN(dt.getTime())) continue

        const key = granularity === 'hour'
            ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}`
            : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

        if (!seriesMap.has(key)) {
            seriesMap.set(
                key,
                createEmptySeriesRow(
                    granularity === 'hour'
                        ? `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:00`
                        : key.slice(5),
                    { _ts: granularity === 'hour' ? new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours()).getTime() : key }
                )
            )
        }

        const row = seriesMap.get(key)
        row.run_count += 1
        row.success_count += getStatus(run.status) === 'success' ? 1 : 0
        row.failure_count += getStatus(run.status) === 'failure' ? 1 : 0
        row.input_tokens += run.tokens_used || 0
        row.output_tokens += run.output_tokens || 0
        row.total_tool_calls += run.tool_calls || 0
        row.estimated_cost += Number(run.estimated_cost_usd || 0)
    }

    return Array.from(seriesMap.values())
        .sort((a, b) => a._ts > b._ts ? 1 : -1)
        .map(({ _ts, ...row }) => row)
}

const buildSeriesFromDailyStats = (dailyStats) => {
    const dailyAgg = new Map()

    for (const day of dailyStats) {
        const key = day.stat_date
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
        row.run_count += day.run_count || 0
        row.success_count += day.success_count || 0
        row.failure_count += day.failure_count || 0
        row.input_tokens += day.total_tokens || 0
        row.output_tokens += day.total_output_tokens || 0
        row.total_tool_calls += day.total_tool_calls || 0
        row.total_cost_usd += Number(day.total_cost_usd || 0)
    }

    return Array.from(dailyAgg.values())
        .sort((a, b) => a.stat_date.localeCompare(b.stat_date))
        .map(row => ({
            ...row,
            estimated_cost: Number(row.total_cost_usd || 0),
            label: row.stat_date?.slice(5) || row.stat_date,
        }))
}

const aggregateSkillRows = (runs) => {
    const skillMap = new Map()

    for (const run of runs) {
        const key = getSkillLabel(run.skill_name)
        if (!skillMap.has(key)) {
            skillMap.set(key, {
                skill_name: key,
                run_count: 0,
                input_tokens: 0,
                output_tokens: 0,
                estimated_cost: 0,
                success_count: 0,
                failure_count: 0,
                projects: new Set(),
                machines: new Set(),
            })
        }

        const row = skillMap.get(key)
        row.run_count += 1
        row.input_tokens += run.tokens_used || 0
        row.output_tokens += run.output_tokens || 0
        row.estimated_cost += Number(run.estimated_cost_usd || 0)
        row.success_count += getStatus(run.status) === 'success' ? 1 : 0
        row.failure_count += getStatus(run.status) === 'failure' ? 1 : 0
        row.projects.add(getProjectLabel(run.project_dir))
        row.machines.add(getMachineLabel(run.machine_id))
    }

    return Array.from(skillMap.values()).map(row => ({
        ...row,
        projects: row.projects.size,
        machines: row.machines.size,
        success_rate: row.run_count > 0 ? (row.success_count / row.run_count) * 100 : 0,
    }))
}

const aggregateDimensionRows = (runs, dimension) => {
    const labelGetter = dimension === 'project' ? getProjectLabel : getMachineLabel
    const field = dimension === 'project' ? 'project_dir' : 'machine_id'
    const rowsMap = new Map()

    for (const run of runs) {
        const key = labelGetter(run[field])
        if (!rowsMap.has(key)) {
            rowsMap.set(key, {
                name: key,
                run_count: 0,
                input_tokens: 0,
                output_tokens: 0,
                estimated_cost: 0,
                success_count: 0,
                failure_count: 0,
                skills: new Map(),
                latest_run_at: null,
            })
        }

        const row = rowsMap.get(key)
        row.run_count += 1
        row.input_tokens += run.tokens_used || 0
        row.output_tokens += run.output_tokens || 0
        row.estimated_cost += Number(run.estimated_cost_usd || 0)
        row.success_count += getStatus(run.status) === 'success' ? 1 : 0
        row.failure_count += getStatus(run.status) === 'failure' ? 1 : 0
        row.latest_run_at = !row.latest_run_at || new Date(run.triggered_at) > new Date(row.latest_run_at)
            ? run.triggered_at
            : row.latest_run_at

        const skillKey = getSkillLabel(run.skill_name)
        row.skills.set(skillKey, (row.skills.get(skillKey) || 0) + 1)
    }

    return Array.from(rowsMap.values())
        .map(row => {
            const topSkillEntry = Array.from(row.skills.entries()).sort((a, b) => b[1] - a[1])[0]
            return {
                name: row.name,
                run_count: row.run_count,
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                estimated_cost: row.estimated_cost,
                success_count: row.success_count,
                failure_count: row.failure_count,
                success_rate: row.run_count > 0 ? (row.success_count / row.run_count) * 100 : 0,
                top_skill: topSkillEntry?.[0] || '—',
                top_skill_runs: topSkillEntry?.[1] || 0,
                latest_run_at: row.latest_run_at,
            }
        })
        .sort((a, b) => (b.run_count - a.run_count) || (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens))
}

function SkillsPanel({ skillRuns = [], skillDailyStats = [], dateRange, customRange, rangeBoundaries, isDarkMode }) {
    const [skillSort, setSkillSort] = useState('runs')
    const [trendTime, setTrendTime] = useState('day')
    const [tableSortCol, setTableSortCol] = useState('triggered_at')
    const [tableSortDir, setTableSortDir] = useState('desc')
    const [activeSkillName, setActiveSkillName] = useState(null)
    const [previousAvgTokensPerRun, setPreviousAvgTokensPerRun] = useState(null)
    const [previousPeriodRunCount, setPreviousPeriodRunCount] = useState(0)
    const [isPreviousAvgLoading, setIsPreviousAvgLoading] = useState(false)

    const handleTableSort = (key) => {
        if (tableSortCol === key) {
            setTableSortDir(d => d === 'desc' ? 'asc' : 'desc')
        } else {
            setTableSortCol(key)
            setTableSortDir('desc')
        }
    }

    const baseRuns = useMemo(() => Array.isArray(skillRuns) ? skillRuns : [], [skillRuns])
    const baseDailyStats = useMemo(() => Array.isArray(skillDailyStats) ? skillDailyStats : [], [skillDailyStats])

    const overviewDailySeries = useMemo(() => {
        const fromDailyStats = buildSeriesFromDailyStats(baseDailyStats)
        return fromDailyStats.length > 0 ? fromDailyStats : buildSeriesFromRuns(baseRuns, 'day')
    }, [baseDailyStats, baseRuns])

    const overviewHourlySeries = useMemo(() => buildSeriesFromRuns(baseRuns, 'hour'), [baseRuns])

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
        recentRuns,
        topProjects,
        topDevices,
    } = useMemo(() => {
        const runs = baseRuns
        const totalInput = runs.reduce((sum, r) => sum + (r.tokens_used || 0), 0)
        const totalOutput = runs.reduce((sum, r) => sum + (r.output_tokens || 0), 0)
        const totalEstimatedCost = runs.reduce((sum, r) => sum + Number(r.estimated_cost_usd || 0), 0)
        const success = runs.filter(r => getStatus(r.status) === 'success').length
        const failure = runs.length - success

        return {
            totalRuns: runs.length,
            uniqueSkills: new Set(runs.map(r => getSkillLabel(r.skill_name))).size,
            uniqueMachines: new Set(runs.map(r => getMachineLabel(r.machine_id))).size,
            uniqueProjects: new Set(runs.map(r => getProjectLabel(r.project_dir))).size,
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            totalCost: totalEstimatedCost,
            successCount: success,
            failureCount: failure,
            successRate: runs.length > 0 ? (success / runs.length) * 100 : 0,
            topSkills: aggregateSkillRows(runs)
                .sort((a, b) => (b.run_count - a.run_count) || (b.input_tokens - a.input_tokens))
                .slice(0, 15),
            recentRuns: runs
                .slice()
                .sort((a, b) => new Date(b.triggered_at) - new Date(a.triggered_at))
                .slice(0, 50),
            topProjects: aggregateDimensionRows(runs, 'project').slice(0, 10),
            topDevices: aggregateDimensionRows(runs, 'machine').slice(0, 10),
        }
    }, [baseRuns])

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

        if (trendTime !== 'day' && overviewDailySeries.length > 0) {
            setTrendTime('day')
            return
        }

        if (overviewDailySeries.length === 0 && overviewHourlySeries.length > 0) {
            setTrendTime('hour')
        }
    }, [dateRange, customRange, trendTime, overviewDailySeries.length, overviewHourlySeries.length])

    useEffect(() => {
        if (activeSkillName && !baseRuns.some(run => getSkillLabel(run.skill_name) === activeSkillName)) {
            setActiveSkillName(null)
        }
    }, [activeSkillName, baseRuns])

    const trendSeries = trendTime === 'hour' ? overviewHourlySeries : overviewDailySeries

    const detailRuns = useMemo(() => {
        if (!activeSkillName) return []
        return baseRuns.filter(run => getSkillLabel(run.skill_name) === activeSkillName)
    }, [baseRuns, activeSkillName])

    const detailSummary = useMemo(() => {
        const runs = detailRuns
        const totalInput = runs.reduce((sum, r) => sum + (r.tokens_used || 0), 0)
        const totalOutput = runs.reduce((sum, r) => sum + (r.output_tokens || 0), 0)
        const totalEstimatedCost = runs.reduce((sum, r) => sum + Number(r.estimated_cost_usd || 0), 0)
        const success = runs.filter(r => getStatus(r.status) === 'success').length
        const failure = runs.length - success
        const totalTokens = totalInput + totalOutput

        return {
            totalRuns: runs.length,
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            totalTokens,
            totalCost: totalEstimatedCost,
            successCount: success,
            failureCount: failure,
            successRate: runs.length > 0 ? (success / runs.length) * 100 : 0,
            uniqueProjects: new Set(runs.map(r => getProjectLabel(r.project_dir))).size,
            uniqueMachines: new Set(runs.map(r => getMachineLabel(r.machine_id))).size,
            currentAvgTokensPerRun: runs.length > 0 ? totalTokens / runs.length : 0,
        }
    }, [detailRuns])

    const detailDailySeries = useMemo(() => buildSeriesFromRuns(detailRuns, 'day'), [detailRuns])
    const detailHourlySeries = useMemo(() => buildSeriesFromRuns(detailRuns, 'hour'), [detailRuns])

    useEffect(() => {
        let isCancelled = false

        const fetchPreviousWindowAvg = async () => {
            if (!activeSkillName || !rangeBoundaries?.startTime) {
                setPreviousAvgTokensPerRun(null)
                setPreviousPeriodRunCount(0)
                setIsPreviousAvgLoading(false)
                return
            }

            const currentStartDate = new Date(rangeBoundaries.startTime)
            if (Number.isNaN(currentStartDate.getTime())) {
                setPreviousAvgTokensPerRun(null)
                setPreviousPeriodRunCount(0)
                setIsPreviousAvgLoading(false)
                return
            }

            const currentEndDate = rangeBoundaries.endTime ? new Date(rangeBoundaries.endTime) : new Date()
            if (Number.isNaN(currentEndDate.getTime())) {
                setPreviousAvgTokensPerRun(null)
                setPreviousPeriodRunCount(0)
                setIsPreviousAvgLoading(false)
                return
            }

            const durationMs = currentEndDate.getTime() - currentStartDate.getTime()
            if (durationMs <= 0) {
                setPreviousAvgTokensPerRun(null)
                setPreviousPeriodRunCount(0)
                setIsPreviousAvgLoading(false)
                return
            }

            const prevEnd = new Date(currentStartDate)
            const prevStart = new Date(currentStartDate.getTime() - durationMs)

            setIsPreviousAvgLoading(true)

            let data = null
            let error = null
            try {
                data = await selectRows('skill_runs', {
                    select: 'tokens_used,output_tokens,triggered_at',
                    filters: [
                        { column: 'skill_name', operator: 'eq', value: activeSkillName },
                        { column: 'is_skeleton', operator: 'eq', value: false },
                        { column: 'triggered_at', operator: 'gte', value: prevStart.toISOString() },
                        { column: 'triggered_at', operator: 'lt', value: prevEnd.toISOString() },
                    ],
                })
            } catch (fetchError) {
                error = fetchError
            }

            if (isCancelled) return

            if (error) {
                console.error('Error fetching previous skill window:', error)
                setPreviousAvgTokensPerRun(null)
                setPreviousPeriodRunCount(0)
                setIsPreviousAvgLoading(false)
                return
            }

            const rows = Array.isArray(data) ? data : []
            if (rows.length === 0) {
                setPreviousAvgTokensPerRun(0)
                setPreviousPeriodRunCount(0)
                setIsPreviousAvgLoading(false)
                return
            }

            const prevTotalTokens = rows.reduce((sum, row) => sum + (row.tokens_used || 0) + (row.output_tokens || 0), 0)
            const prevAvg = rows.length > 0 ? prevTotalTokens / rows.length : 0

            setPreviousAvgTokensPerRun(prevAvg)
            setPreviousPeriodRunCount(rows.length)
            setIsPreviousAvgLoading(false)
        }

        fetchPreviousWindowAvg()

        return () => {
            isCancelled = true
        }
    }, [activeSkillName, rangeBoundaries])
    const detailTrendSeries = trendTime === 'hour' ? detailHourlySeries : detailDailySeries
    const detailTprSeries = useMemo(() => {
        return detailTrendSeries.map(point => {
            const totalTokens = (point.input_tokens || 0) + (point.output_tokens || 0)
            const runCount = point.run_count || 0
            const tpr = runCount > 0 ? totalTokens / runCount : 0
            return {
                ...point,
                total_tokens: totalTokens,
                tpr,
            }
        })
    }, [detailTrendSeries])

    const detailProjectRows = useMemo(() => aggregateDimensionRows(detailRuns, 'project'), [detailRuns])
    const detailDeviceRows = useMemo(() => aggregateDimensionRows(detailRuns, 'machine'), [detailRuns])
    const detailRecentRuns = useMemo(() => {
        return detailRuns
            .slice()
            .sort((a, b) => new Date(b.triggered_at) - new Date(a.triggered_at))
            .slice(0, 20)
    }, [detailRuns])

    const detailTokenDelta = useMemo(() => {
        const currentAvg = detailSummary.currentAvgTokensPerRun || 0
        const previousAvg = typeof previousAvgTokensPerRun === 'number' ? previousAvgTokensPerRun : null

        if (isPreviousAvgLoading) {
            return {
                deltaLabel: 'Calculating vs previous...',
                semanticLabel: '—',
                tone: 'neutral',
            }
        }

        if (detailSummary.totalRuns === 0 && previousPeriodRunCount === 0) {
            return {
                deltaLabel: '—',
                semanticLabel: '—',
                tone: 'neutral',
            }
        }

        if (previousAvg === null) {
            return {
                deltaLabel: '—',
                semanticLabel: '—',
                tone: 'neutral',
            }
        }

        if (previousAvg > 0) {
            const delta = currentAvg - previousAvg
            const deltaPct = (delta / previousAvg) * 100
            const pctMagnitude = formatPercent(Math.abs(deltaPct))
            const pctSigned = deltaPct > 0 ? `+${pctMagnitude}` : deltaPct < 0 ? `-${pctMagnitude}` : pctMagnitude
            const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'

            return {
                deltaLabel: `${arrow} ${pctSigned} vs previous`,
                semanticLabel: delta > 0 ? 'Tốn hơn' : delta < 0 ? 'Tiết kiệm hơn' : 'Không đổi',
                tone: delta > 0 ? 'higher' : delta < 0 ? 'saving' : 'neutral',
            }
        }

        if (previousAvg === 0 && currentAvg > 0) {
            return {
                deltaLabel: 'New baseline',
                semanticLabel: 'Tốn hơn',
                tone: 'higher',
            }
        }

        return {
            deltaLabel: '—',
            semanticLabel: '—',
            tone: 'neutral',
        }
    }, [detailSummary.currentAvgTokensPerRun, detailSummary.totalRuns, previousAvgTokensPerRun, previousPeriodRunCount, isPreviousAvgLoading])

    const renderCell = (r, key, onOpenSkill) => {
        switch (key) {
            case 'skill_name':
                return (
                    <button
                        type="button"
                        className="link-button"
                        onClick={() => onOpenSkill(getSkillLabel(r.skill_name))}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                    >
                        {getSkillLabel(r.skill_name)}
                    </button>
                )
            case 'project_dir': return getProjectLabel(r.project_dir)
            case 'machine_id': return getMachineLabel(r.machine_id)
            case 'triggered_at': return r.triggered_at ? new Date(r.triggered_at).toLocaleString() : '—'
            case 'tokens_used': return formatNumber(r.tokens_used || 0)
            case 'output_tokens': return formatNumber(r.output_tokens || 0)
            case 'duration_ms': return r.duration_ms ? `${formatNumber(r.duration_ms)}ms` : '—'
            case 'status': return getStatus(r.status) === 'failure' ? 'FAILURE' : 'SUCCESS'
            case 'attempt_no': return formatNumber(r.attempt_no || 1)
            case 'estimated_cost_usd': return formatCost(Number(r.estimated_cost_usd || 0))
            case 'error_message': {
                const msg = r.error_message || ''
                return msg ? (msg.length > 80 ? `${msg.slice(0, 80)}…` : msg) : '—'
            }
            case 'model': return getModelLabel(r.model)
            default: return '—'
        }
    }

    const openSkillDetail = (skillName) => {
        setActiveSkillName(skillName)
    }

    const renderRankedDimensionList = (title, rows) => (
        <div className="chart-card chart-half">
            <div className="chart-header">
                <h3>{title}</h3>
            </div>
            <div className="skill-ranked-list">
                {rows.length > 0 ? rows.map((row, i) => {
                    const maxVal = rows[0].run_count
                    const pct = maxVal > 0 ? (row.run_count / maxVal) * 100 : 0
                    const color = CHART_COLORS[i % CHART_COLORS.length]
                    return (
                        <div key={row.name} className="skill-rank-row">
                            <span className="skill-rank-num" style={{ color }}>{i + 1}</span>
                            <div className="skill-rank-body">
                                <div className="skill-rank-top">
                                    <span className="skill-rank-name">{row.name}</span>
                                    <span className="skill-rank-stats">
                                        <span className="skill-stat-pill">{formatNumber(row.run_count)} runs</span>
                                        <span className="skill-stat-pill">{formatNumber(row.input_tokens + row.output_tokens)} tok</span>
                                        <span className="skill-stat-pill">{row.top_skill}</span>
                                    </span>
                                </div>
                                <div className="skill-rank-bar-track">
                                    <div className="skill-rank-bar-fill" style={{ width: `${pct}%`, background: color }} />
                                </div>
                            </div>
                        </div>
                    )
                }) : (
                    <div className="empty-state">No data</div>
                )}
            </div>
        </div>
    )

    const detailColumns = [
        { key: 'name', label: 'Name' },
        { key: 'run_count', label: 'Runs', render: v => formatNumber(v) },
        { key: 'input_tokens', label: 'Input', render: v => formatNumber(v) },
        { key: 'output_tokens', label: 'Output', render: v => formatNumber(v) },
        { key: 'estimated_cost', label: 'Cost', render: v => formatCost(v) },
        { key: 'success_rate', label: 'Success', render: v => formatPercent(v) },
        { key: 'top_skill', label: 'Top Skill' },
    ]

    const runAxisTickFormatter = (v) => formatNumber(v)
    const tokenAxisTickFormatter = (v) => {
        if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
        if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
        return formatNumber(v)
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
                <div className="chart-card chart-half">
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
                                            <button
                                                type="button"
                                                className="skill-rank-name"
                                                onClick={() => openSkillDetail(s.skill_name)}
                                                style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer' }}
                                            >
                                                {s.skill_name}
                                            </button>
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
                {renderRankedDimensionList('Top Projects', topProjects)}
                {renderRankedDimensionList('Top Devices', topDevices)}
            </div>

            <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Skill Requests + Token Trend</h3>
                    </div>
                    <div className="chart-body chart-body-dark">
                        {trendSeries.length > 0 ? (
                            <>
                                <div className="skills-mixed-chart-legend">
                                    <span className="skills-legend-chip requests">
                                        <span className="skills-legend-dot requests" aria-hidden="true" />
                                        Requests (column)
                                    </span>
                                    <span className="skills-legend-chip input">
                                        <span className="skills-legend-dot input" aria-hidden="true" />
                                        Input Tokens (line)
                                    </span>
                                    <span className="skills-legend-chip output">
                                        <span className="skills-legend-dot output" aria-hidden="true" />
                                        Output Tokens (line)
                                    </span>
                                </div>
                                <ResponsiveContainer width="100%" height={280}>
                                    <ComposedChart data={trendSeries} margin={{ top: 10, right: 18, left: 4, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gradSkillRequests" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} vertical={false} />
                                        <XAxis dataKey="label" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={CHART_TYPOGRAPHY.axisTick} axisLine={false} tickLine={false} />
                                        <YAxis
                                            yAxisId="left"
                                            stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                            tick={CHART_TYPOGRAPHY.axisTick}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={runAxisTickFormatter}
                                            width={52}
                                        />
                                        <YAxis
                                            yAxisId="right"
                                            orientation="right"
                                            stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                            tick={CHART_TYPOGRAPHY.axisTick}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={tokenAxisTickFormatter}
                                            width={56}
                                        />
                                        <Tooltip
                                            cursor={{ fill: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}
                                            content={({ active, payload, label }) => {
                                                if (!active || !payload?.length) return null
                                                const item = payload[0].payload
                                                return (
                                                    <div className="skills-chart-tooltip">
                                                        <div className="skills-chart-tooltip-label">{label}</div>
                                                        <div className="skills-chart-tooltip-item requests">Requests: {formatNumber(item.run_count || 0)}</div>
                                                        <div className="skills-chart-tooltip-item input">Input Tokens: {formatNumber(item.input_tokens || 0)}</div>
                                                        <div className="skills-chart-tooltip-item output">Output Tokens: {formatNumber(item.output_tokens || 0)}</div>
                                                        <div className="skills-chart-tooltip-item">Success: {(item.success_count || 0).toLocaleString()}</div>
                                                        <div className="skills-chart-tooltip-item">Failure: {(item.failure_count || 0).toLocaleString()}</div>
                                                        <div className="skills-chart-tooltip-item cost">Cost: {formatCost(item.estimated_cost)}</div>
                                                    </div>
                                                )
                                            }}
                                        />
                                        <Bar
                                            yAxisId="left"
                                            dataKey="run_count"
                                            name="Requests"
                                            fill="url(#gradSkillRequests)"
                                            stroke={SERIES_COLORS.requests}
                                            strokeWidth={1}
                                            radius={[0, 4, 4, 0]}
                                            maxBarSize={30}
                                        />
                                        <Line
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="input_tokens"
                                            name="Input"
                                            stroke={SERIES_COLORS.input}
                                            strokeWidth={2.4}
                                            dot={false}
                                            activeDot={{ r: 4, strokeWidth: 2, fill: isDarkMode ? '#0b1220' : '#ffffff' }}
                                        />
                                        <Line
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="output_tokens"
                                            name="Output"
                                            stroke={SERIES_COLORS.output}
                                            strokeWidth={2.4}
                                            dot={false}
                                            activeDot={{ r: 4, strokeWidth: 2, fill: isDarkMode ? '#0b1220' : '#ffffff' }}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </>
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
                                <tr key={`${r.event_uid || r.session_id}-${idx}`}>
                                    {RECENT_COLUMNS.map(col => (
                                        <td key={col.key}>{renderCell(r, col.key, openSkillDetail)}</td>
                                    ))}
                                </tr>
                            )) : (
                                <tr><td colSpan={RECENT_COLUMNS.length} className="empty">No runs synced yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <ChartDialog
                isOpen={Boolean(activeSkillName)}
                onClose={() => setActiveSkillName(null)}
                title={activeSkillName ? `Skill Detail — ${activeSkillName}` : 'Skill Detail'}
            >
                {activeSkillName ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-header"><span className="stat-label">TOTAL RUNS</span></div>
                                <div className="stat-value">{formatNumber(detailSummary.totalRuns)}</div>
                                <div className="stat-meta">{detailSummary.uniqueProjects} projects · {detailSummary.uniqueMachines} devices</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-header"><span className="stat-label">TOKENS</span></div>
                                <div className="stat-value">{formatNumber(detailSummary.totalTokens)}</div>
                                <div className="stat-meta">{formatNumber(detailSummary.totalInputTokens)} input · {formatNumber(detailSummary.totalOutputTokens)} output</div>
                                <div className="stat-meta">Avg {formatNumber(detailSummary.currentAvgTokensPerRun)} / run · {detailTokenDelta.deltaLabel} · {detailTokenDelta.semanticLabel}</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-header"><span className="stat-label">SUCCESS RATE</span></div>
                                <div className="stat-value">{formatPercent(detailSummary.successRate)}</div>
                                <div className="stat-meta">{formatNumber(detailSummary.successCount)} success · {formatNumber(detailSummary.failureCount)} failures</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-header"><span className="stat-label">TOTAL COST</span></div>
                                <div className="stat-value"><span className="cost-value">{formatCost(detailSummary.totalCost)}</span></div>
                                <div className="stat-meta">Average {formatCost(detailSummary.totalRuns > 0 ? detailSummary.totalCost / detailSummary.totalRuns : 0)} / run</div>
                            </div>
                        </div>

                        <div className="chart-card chart-full">
                            <div className="chart-header">
                                <h3>TPR Trend (Tokens per Run)</h3>
                            </div>
                            <div className="chart-body chart-body-dark">
                                {detailTprSeries.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={260}>
                                        <AreaChart data={detailTprSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="gradSkillDetailTpr" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                                                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="4 4" stroke={isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />
                                            <XAxis dataKey="label" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={CHART_TYPOGRAPHY.axisTick} axisLine={false} tickLine={false} />
                                            <YAxis
                                                stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                                tick={CHART_TYPOGRAPHY.axisTick}
                                                axisLine={false}
                                                tickLine={false}
                                                tickFormatter={formatTprAxis}
                                            />
                                            <Tooltip content={({ active, payload, label }) => {
                                                if (!active || !payload?.length) return null
                                                const item = payload[0].payload
                                                return (
                                                    <div style={{ padding: '8px 10px', background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'white', border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`, borderRadius: 8 }}>
                                                        <div style={{ ...CHART_TYPOGRAPHY.tooltipLabel, marginBottom: 4 }}>{label}</div>
                                                        <div style={{ ...CHART_TYPOGRAPHY.tooltipItem, color: '#22c55e' }}>TPR: {formatTpr(item.tpr)} tokens/run</div>
                                                        <div style={CHART_TYPOGRAPHY.tooltipItem}>Runs: {formatNumber(item.run_count || 0)}</div>
                                                        <div style={CHART_TYPOGRAPHY.tooltipItem}>Total tokens: {formatNumber(item.total_tokens || 0)}</div>
                                                        <div style={CHART_TYPOGRAPHY.tooltipItem}>Input: {formatNumber(item.input_tokens || 0)}</div>
                                                        <div style={CHART_TYPOGRAPHY.tooltipItem}>Output: {formatNumber(item.output_tokens || 0)}</div>
                                                        <div style={{ ...CHART_TYPOGRAPHY.tooltipItem, color: '#10b981' }}>Cost: {formatCost(item.estimated_cost)}</div>
                                                    </div>
                                                )
                                            }} />
                                            <Area
                                                type="monotone"
                                                dataKey="tpr"
                                                name="TPR"
                                                stroke="#22c55e"
                                                fill="url(#gradSkillDetailTpr)"
                                                strokeWidth={2}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="empty-state">No TPR trend data for this skill</div>
                                )}
                            </div>
                        </div>

                        <div className="chart-card chart-full">
                            <div className="chart-header">
                                <h3>Breakdown by Project</h3>
                            </div>
                            <DrilldownPanel
                                columns={detailColumns}
                                rows={detailProjectRows}
                            />
                        </div>

                        <div className="chart-card chart-full">
                            <div className="chart-header">
                                <h3>Breakdown by Device</h3>
                            </div>
                            <DrilldownPanel
                                columns={detailColumns}
                                rows={detailDeviceRows}
                            />
                        </div>

                        <div className="chart-card chart-full">
                            <div className="chart-header">
                                <h3>Recent Runs</h3>
                            </div>
                            <div className="table-wrapper">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Triggered</th>
                                            <th>Project</th>
                                            <th>Device</th>
                                            <th>Status</th>
                                            <th>Input</th>
                                            <th>Output</th>
                                            <th>Cost</th>
                                            <th>Model</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detailRecentRuns.length > 0 ? detailRecentRuns.map((run, idx) => (
                                            <tr key={`${run.event_uid || run.session_id}-detail-${idx}`}>
                                                <td>{run.triggered_at ? new Date(run.triggered_at).toLocaleString() : '—'}</td>
                                                <td>{getProjectLabel(run.project_dir)}</td>
                                                <td>{getMachineLabel(run.machine_id)}</td>
                                                <td>{getStatus(run.status) === 'failure' ? 'FAILURE' : 'SUCCESS'}</td>
                                                <td>{formatNumber(run.tokens_used || 0)}</td>
                                                <td>{formatNumber(run.output_tokens || 0)}</td>
                                                <td>{formatCost(Number(run.estimated_cost_usd || 0))}</td>
                                                <td>{getModelLabel(run.model)}</td>
                                            </tr>
                                        )) : (
                                            <tr><td colSpan={8} className="empty">No runs for this skill</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : null}
            </ChartDialog>
        </div>
    )
}

export default SkillsPanel
