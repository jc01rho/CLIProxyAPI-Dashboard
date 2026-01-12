import { useState, useMemo } from 'react'

// Color scale for heatmap - from light to dark based on intensity
const getHeatColor = (value, max, isDarkMode) => {
    if (value === 0 || max === 0) {
        return isDarkMode ? 'rgba(30, 41, 59, 0.5)' : 'rgba(241, 245, 249, 0.8)'
    }
    
    const intensity = Math.min(value / max, 1)
    
    // Blue color scale
    if (isDarkMode) {
        const r = Math.round(30 + intensity * (59 - 30))
        const g = Math.round(41 + intensity * (130 - 41))
        const b = Math.round(59 + intensity * (246 - 59))
        return `rgba(${r}, ${g}, ${b}, ${0.4 + intensity * 0.6})`
    } else {
        const r = Math.round(241 - intensity * (241 - 59))
        const g = Math.round(245 - intensity * (245 - 130))
        const b = Math.round(249 - intensity * (249 - 246))
        return `rgba(${r}, ${g}, ${b}, ${0.5 + intensity * 0.5})`
    }
}

const HEATMAP_RANGES = [
    { label: 'Today', id: 'today', days: 1 },
    { label: '7 Days', id: '7d', days: 7 },
    { label: '30 Days', id: '30d', days: 30 }
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function UsageHeatmap({ dailyStats, isDarkMode }) {
    const [range, setRange] = useState('7d')
    
    // Process data into heatmap format
    const heatmapData = useMemo(() => {
        if (!dailyStats || dailyStats.length === 0) return { rows: [], maxValue: 0 }
        
        const selectedRange = HEATMAP_RANGES.find(r => r.id === range)
        const daysToShow = selectedRange?.days || 7
        
        // Get the last N days of data
        const recentStats = dailyStats
            .slice(-daysToShow)
            .map(day => ({
                date: day.stat_date,
                hourly: day.breakdown?.hourly || {}
            }))
        
        // Calculate max value for color scaling
        let maxValue = 0
        recentStats.forEach(day => {
            HOURS.forEach(hour => {
                const hourKey = hour.toString().padStart(2, '0')
                const requests = day.hourly[hourKey]?.requests || 0
                if (requests > maxValue) maxValue = requests
            })
        })
        
        // Build rows (one per day)
        const rows = recentStats.map(day => {
            const cells = HOURS.map(hour => {
                const hourKey = hour.toString().padStart(2, '0')
                const hourData = day.hourly[hourKey] || { requests: 0, tokens: 0, cost: 0 }
                return {
                    hour,
                    requests: hourData.requests || 0,
                    tokens: hourData.tokens || 0,
                    cost: hourData.cost || 0
                }
            })
            
            return {
                date: day.date,
                displayDate: new Date(day.date).toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric' 
                }),
                cells
            }
        })
        
        return { rows, maxValue }
    }, [dailyStats, range])
    
    const formatNumber = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
        return num.toString()
    }
    
    return (
        <div className="chart-card" style={{ marginTop: '24px' }}>
            <div className="chart-header">
                <h3>📊 Usage Pattern Heatmap</h3>
                <div className="chart-tabs">
                    {HEATMAP_RANGES.map(r => (
                        <button 
                            key={r.id}
                            className={`tab ${range === r.id ? 'active' : ''}`}
                            onClick={() => setRange(r.id)}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>
            
            <div className="chart-body" style={{ padding: '16px', overflowX: 'auto' }}>
                {heatmapData.rows.length > 0 ? (
                    <div style={{ minWidth: '800px' }}>
                        {/* Hour labels */}
                        <div style={{ 
                            display: 'flex', 
                            marginLeft: '100px',
                            marginBottom: '4px'
                        }}>
                            {HOURS.map(hour => (
                                <div 
                                    key={hour} 
                                    style={{ 
                                        width: '28px', 
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
                        {heatmapData.rows.map((row, rowIdx) => (
                            <div 
                                key={row.date} 
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center',
                                    marginBottom: '2px'
                                }}
                            >
                                {/* Date label */}
                                <div style={{ 
                                    width: '100px', 
                                    fontSize: '11px',
                                    color: isDarkMode ? '#94a3b8' : '#64748b',
                                    paddingRight: '8px',
                                    textAlign: 'right',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {row.displayDate}
                                </div>
                                
                                {/* Hour cells */}
                                {row.cells.map((cell, cellIdx) => (
                                    <div
                                        key={`${row.date}-${cell.hour}`}
                                        title={`${row.displayDate} ${cell.hour}:00\nRequests: ${formatNumber(cell.requests)}\nTokens: ${formatNumber(cell.tokens)}\nCost: $${cell.cost.toFixed(2)}`}
                                        style={{
                                            width: '26px',
                                            height: '20px',
                                            margin: '1px',
                                            borderRadius: '3px',
                                            backgroundColor: getHeatColor(cell.requests, heatmapData.maxValue, isDarkMode),
                                            cursor: 'pointer',
                                            transition: 'transform 0.15s, box-shadow 0.15s',
                                            border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                                        }}
                                        onMouseOver={(e) => {
                                            e.target.style.transform = 'scale(1.2)'
                                            e.target.style.zIndex = '10'
                                            e.target.style.boxShadow = isDarkMode 
                                                ? '0 4px 12px rgba(0,0,0,0.4)' 
                                                : '0 4px 12px rgba(0,0,0,0.15)'
                                        }}
                                        onMouseOut={(e) => {
                                            e.target.style.transform = 'scale(1)'
                                            e.target.style.zIndex = '1'
                                            e.target.style.boxShadow = 'none'
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
                            <span style={{ 
                                fontSize: '11px', 
                                color: isDarkMode ? '#64748b' : '#94a3b8' 
                            }}>
                                Less
                            </span>
                            {[0, 0.25, 0.5, 0.75, 1].map((intensity, i) => (
                                <div
                                    key={i}
                                    style={{
                                        width: '14px',
                                        height: '14px',
                                        borderRadius: '2px',
                                        backgroundColor: getHeatColor(
                                            intensity * heatmapData.maxValue, 
                                            heatmapData.maxValue, 
                                            isDarkMode
                                        )
                                    }}
                                />
                            ))}
                            <span style={{ 
                                fontSize: '11px', 
                                color: isDarkMode ? '#64748b' : '#94a3b8' 
                            }}>
                                More
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="empty-state">
                        No usage data available for the selected period
                    </div>
                )}
            </div>
        </div>
    )
}

export default UsageHeatmap
