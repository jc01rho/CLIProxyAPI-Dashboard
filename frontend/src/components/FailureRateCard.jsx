import { useState, useMemo } from 'react'
import {
    LineChart, Line, BarChart, Bar,
    XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'

// Color scale for failure rate - green to red
const getFailureColor = (rate, isDarkMode) => {
    if (rate === 0) return isDarkMode ? '#10b981' : '#22c55e' // Green
    if (rate < 5) return isDarkMode ? '#84cc16' : '#a3e635' // Light green
    if (rate < 10) return isDarkMode ? '#f59e0b' : '#fbbf24' // Yellow/Orange
    if (rate < 20) return isDarkMode ? '#f97316' : '#fb923c' // Orange
    return isDarkMode ? '#ef4444' : '#dc2626' // Red
}

const TABS = [
    { id: 'hourly', label: 'Hourly Trend' },
    { id: 'model', label: 'By Model' },
    { id: 'heatmap', label: 'Heatmap' }
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function FailureRateCard({ dailyStats, isDarkMode }) {
    const [activeTab, setActiveTab] = useState('hourly')
    
    // Calculate failure rate data
    const { hourlyData, modelData, heatmapData, overallRate } = useMemo(() => {
        if (!dailyStats || dailyStats.length === 0) {
            return { hourlyData: [], modelData: [], heatmapData: [], overallRate: 0 }
        }
        
        // Overall failure rate
        const totalRequests = dailyStats.reduce((sum, d) => sum + (d.total_requests || 0), 0)
        const totalFailures = dailyStats.reduce((sum, d) => sum + (d.failure_count || 0), 0)
        const overallRate = totalRequests > 0 ? (totalFailures / totalRequests) * 100 : 0
        
        // Hourly aggregation across all days
        const hourlyAgg = {}
        HOURS.forEach(h => {
            hourlyAgg[h] = { requests: 0, failures: 0 }
        })
        
        dailyStats.forEach(day => {
            const hourly = day.breakdown?.hourly || {}
            Object.entries(hourly).forEach(([hourKey, data]) => {
                const hour = parseInt(hourKey, 10)
                if (!isNaN(hour)) {
                    hourlyAgg[hour].requests += data.requests || 0
                    // We don't have failures per hour currently, estimate from day ratio
                    // For now, distribute day's failures proportionally
                }
            })
        })
        
        // Since we don't have hourly failure data, calculate from daily for now
        // Just show overall trend per hour based on requests
        const hourlyData = HOURS.map(hour => {
            const hourKey = hour.toString().padStart(2, '0')
            let requests = 0
            let tokens = 0
            
            dailyStats.forEach(day => {
                const hourData = day.breakdown?.hourly?.[hourKey] || {}
                requests += hourData.requests || 0
                tokens += hourData.tokens || 0
            })
            
            // Estimate failure rate proportionally (placeholder until we have real data)
            const failureRate = overallRate
            
            return {
                hour: `${hour}:00`,
                requests,
                failureRate: failureRate.toFixed(1)
            }
        })
        
        // Model breakdown with failure rates
        const modelAgg = {}
        dailyStats.forEach(day => {
            const models = day.breakdown?.models || {}
            Object.entries(models).forEach(([modelName, data]) => {
                if (!modelAgg[modelName]) {
                    modelAgg[modelName] = { requests: 0, failures: 0, tokens: 0, cost: 0 }
                }
                modelAgg[modelName].requests += data.requests || 0
                modelAgg[modelName].failures += data.failures || 0
                modelAgg[modelName].tokens += data.tokens || 0
                modelAgg[modelName].cost += data.cost || 0
            })
        })
        
        const modelData = Object.entries(modelAgg)
            .map(([name, data]) => ({
                model: name.length > 20 ? name.substring(0, 18) + '...' : name,
                fullName: name,
                requests: data.requests,
                failures: data.failures,
                failureRate: data.requests > 0 ? (data.failures / data.requests) * 100 : 0
            }))
            .sort((a, b) => b.failureRate - a.failureRate)
            .slice(0, 10) // Top 10 by failure rate
        
        // Heatmap data: Model × Hour
        const topModels = Object.entries(modelAgg)
            .sort((a, b) => b[1].requests - a[1].requests)
            .slice(0, 5)
            .map(([name]) => name)
        
        const heatmapData = topModels.map(modelName => {
            const cells = HOURS.map(hour => {
                const hourKey = hour.toString().padStart(2, '0')
                let requests = 0
                let failures = 0
                
                dailyStats.forEach(day => {
                    const hourData = day.breakdown?.hourly?.[hourKey]
                    if (hourData?.models?.[modelName]) {
                        requests += hourData.models[modelName].requests || 0
                        // No failures per model per hour yet, use estimate
                    }
                })
                
                // For now, use overall model failure rate
                const modelFailureRate = modelAgg[modelName]?.requests > 0 
                    ? (modelAgg[modelName].failures / modelAgg[modelName].requests) * 100 
                    : 0
                
                return {
                    hour,
                    requests,
                    failureRate: requests > 0 ? modelFailureRate : 0
                }
            })
            
            return {
                model: modelName.length > 15 ? modelName.substring(0, 13) + '...' : modelName,
                fullName: modelName,
                cells
            }
        })
        
        return { hourlyData, modelData, heatmapData, overallRate }
    }, [dailyStats])
    
    // Custom tooltip
    const CustomTooltip = ({ active, payload, label }) => {
        if (!active || !payload?.length) return null
        
        return (
            <div style={{
                background: isDarkMode ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)',
                border: `1px solid ${isDarkMode ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.4)'}`,
                borderRadius: 8,
                padding: '10px 14px',
                boxShadow: isDarkMode
                    ? '0 8px 24px rgba(0,0,0,0.4)'
                    : '0 8px 24px rgba(0,0,0,0.1)',
            }}>
                <div style={{
                    color: isDarkMode ? '#F8FAFC' : '#0F172A',
                    fontWeight: 600,
                    marginBottom: 4
                }}>{label}</div>
                {payload.map((p, i) => (
                    <div key={i} style={{
                        color: isDarkMode ? '#94A3B8' : '#475569',
                        fontSize: 12,
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center'
                    }}>
                        <span style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: p.color
                        }}></span>
                        <span>{p.name}:</span>
                        <span style={{ fontWeight: 600, color: isDarkMode ? '#F8FAFC' : '#0F172A' }}>
                            {p.dataKey === 'failureRate' ? `${p.value}%` : p.value?.toLocaleString()}
                        </span>
                    </div>
                ))}
            </div>
        )
    }
    
    return (
        <div className="chart-card" style={{ marginTop: '24px' }}>
            <div className="chart-header">
                <h3>
                    ⚠️ Failure Rate Analysis
                    <span style={{
                        marginLeft: '12px',
                        fontSize: '14px',
                        fontWeight: 500,
                        color: getFailureColor(overallRate, isDarkMode),
                        background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                        padding: '4px 10px',
                        borderRadius: '12px'
                    }}>
                        {overallRate.toFixed(1)}% overall
                    </span>
                </h3>
                <div className="chart-tabs">
                    {TABS.map(tab => (
                        <button 
                            key={tab.id}
                            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>
            
            <div className="chart-body" style={{ padding: '16px' }}>
                {/* Hourly Trend */}
                {activeTab === 'hourly' && (
                    <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={hourlyData}>
                            <XAxis 
                                dataKey="hour" 
                                stroke={isDarkMode ? '#6e7681' : '#57606a'} 
                                tick={{ fontSize: 11 }} 
                                axisLine={false} 
                                tickLine={false}
                                interval={2}
                            />
                            <YAxis 
                                stroke={isDarkMode ? '#6e7681' : '#57606a'} 
                                tick={{ fontSize: 11 }} 
                                axisLine={false} 
                                tickLine={false}
                                tickFormatter={(val) => `${val}%`}
                                domain={[0, 'auto']}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Line
                                type="monotone"
                                dataKey="failureRate"
                                name="Failure Rate"
                                stroke="#ef4444"
                                strokeWidth={2}
                                dot={{ fill: '#ef4444', r: 3 }}
                                activeDot={{ r: 5 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                )}
                
                {/* Model Breakdown */}
                {activeTab === 'model' && (
                    modelData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={Math.max(200, modelData.length * 36)}>
                            <BarChart data={modelData} layout="vertical" margin={{ left: 10, right: 60 }}>
                                <XAxis 
                                    type="number" 
                                    stroke={isDarkMode ? '#6e7681' : '#57606a'} 
                                    tick={{ fontSize: 11 }} 
                                    axisLine={false} 
                                    tickLine={false}
                                    tickFormatter={(val) => `${val}%`}
                                    domain={[0, 'auto']}
                                />
                                <YAxis 
                                    type="category" 
                                    dataKey="model" 
                                    stroke={isDarkMode ? '#6e7681' : '#57606a'} 
                                    tick={{ fontSize: 11 }}
                                    width={140}
                                    axisLine={false} 
                                    tickLine={false}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={false} />
                                <Bar 
                                    dataKey="failureRate" 
                                    name="Failure Rate"
                                    radius={[0, 4, 4, 0]}
                                    label={{
                                        position: 'right',
                                        fill: isDarkMode ? '#94a3b8' : '#64748b',
                                        fontSize: 11,
                                        formatter: (val) => `${val.toFixed(1)}%`
                                    }}
                                >
                                    {modelData.map((entry, index) => (
                                        <Cell 
                                            key={`cell-${index}`} 
                                            fill={getFailureColor(entry.failureRate, isDarkMode)} 
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty-state">No model failure data available</div>
                    )
                )}
                
                {/* Heatmap: Model × Hour */}
                {activeTab === 'heatmap' && (
                    heatmapData.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                            <div style={{ minWidth: '700px' }}>
                                {/* Hour labels */}
                                <div style={{ 
                                    display: 'flex', 
                                    marginLeft: '120px',
                                    marginBottom: '4px'
                                }}>
                                    {HOURS.filter((_, i) => i % 2 === 0).map(hour => (
                                        <div 
                                            key={hour} 
                                            style={{ 
                                                width: '48px', 
                                                textAlign: 'center',
                                                fontSize: '10px',
                                                color: isDarkMode ? '#64748b' : '#94a3b8'
                                            }}
                                        >
                                            {hour}
                                        </div>
                                    ))}
                                </div>
                                
                                {/* Heatmap rows */}
                                {heatmapData.map((row) => (
                                    <div 
                                        key={row.fullName} 
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'center',
                                            marginBottom: '2px'
                                        }}
                                    >
                                        {/* Model label */}
                                        <div 
                                            style={{ 
                                                width: '120px', 
                                                fontSize: '11px',
                                                color: isDarkMode ? '#94a3b8' : '#64748b',
                                                paddingRight: '8px',
                                                textAlign: 'right',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis'
                                            }}
                                            title={row.fullName}
                                        >
                                            {row.model}
                                        </div>
                                        
                                        {/* Hour cells */}
                                        {row.cells.map((cell) => (
                                            <div
                                                key={`${row.fullName}-${cell.hour}`}
                                                title={`${row.fullName} @ ${cell.hour}:00\nRequests: ${cell.requests}\nFailure Rate: ${cell.failureRate.toFixed(1)}%`}
                                                style={{
                                                    width: '22px',
                                                    height: '22px',
                                                    margin: '1px',
                                                    borderRadius: '3px',
                                                    backgroundColor: cell.requests > 0 
                                                        ? getFailureColor(cell.failureRate, isDarkMode)
                                                        : isDarkMode ? 'rgba(30, 41, 59, 0.5)' : 'rgba(241, 245, 249, 0.8)',
                                                    opacity: cell.requests > 0 ? 1 : 0.3,
                                                    cursor: 'pointer',
                                                    transition: 'transform 0.15s',
                                                    border: cell.failureRate >= 10 
                                                        ? '1px solid rgba(239, 68, 68, 0.5)' 
                                                        : `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                                                }}
                                                onMouseOver={(e) => {
                                                    e.target.style.transform = 'scale(1.15)'
                                                }}
                                                onMouseOut={(e) => {
                                                    e.target.style.transform = 'scale(1)'
                                                }}
                                            />
                                        ))}
                                    </div>
                                ))}
                                
                                {/* Legend */}
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'flex-end',
                                    marginTop: '16px',
                                    gap: '8px'
                                }}>
                                    <span style={{ fontSize: '11px', color: isDarkMode ? '#64748b' : '#94a3b8' }}>
                                        0%
                                    </span>
                                    {[0, 5, 10, 20, 30].map((rate, i) => (
                                        <div
                                            key={i}
                                            style={{
                                                width: '14px',
                                                height: '14px',
                                                borderRadius: '2px',
                                                backgroundColor: getFailureColor(rate, isDarkMode)
                                            }}
                                        />
                                    ))}
                                    <span style={{ fontSize: '11px', color: isDarkMode ? '#64748b' : '#94a3b8' }}>
                                        30%+
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="empty-state">No heatmap data available</div>
                    )
                )}
            </div>
        </div>
    )
}

export default FailureRateCard
