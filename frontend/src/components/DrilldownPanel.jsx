import { getModelColor } from '../lib/brandColors'

const formatNumber = (num) => {
    if (!num && num !== 0) return '0'
    return Math.round(num).toLocaleString('en-US')
}

/**
 * DrilldownPanel - Flexible table for dialog content
 *
 * Supports multiple data shapes via `columns` + `rows` props,
 * or auto-renders from `data.models` for backwards compatibility.
 */
export default function DrilldownPanel({ data, columns, rows }) {
    // Custom columns/rows mode (for API key breakdown, credential details, etc.)
    if (columns && rows) {
        if (rows.length === 0) return <div className="drilldown-empty">No data available</div>
        return (
            <div className="drilldown-panel">
                <table className="drilldown-table">
                    <thead>
                        <tr>
                            {columns.map(col => <th key={col.key}>{col.label}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={row._key || i}>
                                {columns.map(col => (
                                    <td key={col.key}>
                                        {col.render ? col.render(row[col.key], row) : row[col.key]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )
    }

    // Auto mode: render from data.models
    if (!data?.models || Object.keys(data.models).length === 0) return null

    const models = Object.entries(data.models)
        .map(([name, values]) => ({
            name,
            requests: values.requests || values.request_count || 0,
            tokens: values.tokens || values.total_tokens || 0,
            cost: values.cost || values.estimated_cost_usd || 0,
            color: getModelColor(name)
        }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 10)

    return (
        <div className="drilldown-panel">
            <table className="drilldown-table">
                <thead>
                    <tr>
                        <th>Model</th>
                        <th>Requests</th>
                        <th>Tokens</th>
                        <th>Cost</th>
                    </tr>
                </thead>
                <tbody>
                    {models.map((m) => (
                        <tr key={m.name}>
                            <td>
                                <span className="color-dot" style={{ background: m.color }}></span>
                                {m.name}
                            </td>
                            <td>{formatNumber(m.requests)}</td>
                            <td>{formatNumber(m.tokens)}</td>
                            <td>${m.cost < 1 ? m.cost.toFixed(2) : Math.round(m.cost).toLocaleString('en-US')}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
