
import { supabase } from './supabase'

/**
 * Load Rate Limits from Supabase
 * Returns a config object structure compatible with the UI
 */
export async function loadRateLimitsConfig() {
    try {
        // Fetch configs and status in parallel
        const [configsResult, statusResult] = await Promise.all([
            supabase.from('rate_limit_configs').select('*'),
            supabase.from('rate_limit_status').select('*')
        ])

        if (configsResult.error) {
            console.error('Error loading config:', configsResult.error)
            return null
        }

        const configs = configsResult.data
        // Create a map of status by config_id for O(1) lookup
        const statusMap = new Map(
            (statusResult.data || []).map(s => [s.config_id, s])
        )

        // Transform to UI structure
        const providers = {}
        const providerIcons = {
            'OpenAI': '🤖',
            'Anthropic': '🟣',
            'Google': '💎'
        }

        configs.forEach(conf => {
            const providerKey = conf.provider.toLowerCase()

            if (!providers[providerKey]) {
                providers[providerKey] = {
                    name: conf.provider + (conf.tier_name ? ` ${conf.tier_name}` : ''),
                    icon: providerIcons[conf.provider] || '🔌',
                    enabled: true,
                    limits: []
                }
            }

            // Determine limit type and value for UI
            let limitVal = 0
            let limitUnit = 'requests' // Default
            let percentage = 0
            let usedLabel = ''

            // Join with status manually
            const status = statusMap.get(conf.id)

            // Prioritize Token Limit if exists, else Request Limit
            if (conf.token_limit) {
                limitVal = conf.token_limit
                limitUnit = 'tokens'
                const remaining = status?.remaining_tokens ?? conf.token_limit
                // Clamp remaining to 0-limit for percentage calculation
                const safeRemaining = Math.max(0, Math.min(remaining, conf.token_limit))
                percentage = Math.round((safeRemaining / conf.token_limit) * 100)

                const used = Math.max(0, conf.token_limit - remaining)
                usedLabel = `${(used / 1000).toFixed(1)}k / ${(conf.token_limit / 1000).toFixed(0)}k`
            } else if (conf.request_limit) {
                limitVal = conf.request_limit
                limitUnit = 'requests'
                const remaining = status?.remaining_requests ?? conf.request_limit
                // Clamp remaining
                const safeRemaining = Math.max(0, Math.min(remaining, conf.request_limit))
                percentage = Math.round((safeRemaining / conf.request_limit) * 100)

                const used = Math.max(0, conf.request_limit - remaining)
                usedLabel = `${used} / ${conf.request_limit}`
            } else {
                // Unlimited / Info only
                limitVal = 0
                percentage = 100
                usedLabel = 'Unlimited'
            }

            providers[providerKey].limits.push({
                id: conf.id, // UUID
                name: conf.model_pattern || 'All Models',
                limit: limitVal,
                unit: limitUnit,
                resetType: conf.reset_strategy,
                windowHours: Math.round(conf.window_minutes / 60),
                resetTime: '00:00', // Default
                // Backend status for display
                backendStatus: {
                    percentage,
                    nextReset: status?.next_reset,
                    label: usedLabel
                }
            })
        })

        return { providers }

    } catch (e) {
        console.error('Failed to load rate limits:', e)
        return null
    }
}

/**
 * Save Config to Supabase
 * Performs diffing to Insert, Update, or Delete limits
 */
export async function saveConfig(newConfig) {
    if (!newConfig || !newConfig.providers) return

    try {
        // 1. Fetch current IDs from DB to detect deletions
        const { data: currentRows } = await supabase
            .from('rate_limit_configs')
            .select('id')

        const existingIds = new Set(currentRows?.map(r => r.id) || [])
        const keptIds = new Set()

        const upsertData = []

        // 2. Iterate new config to build upsert list
        Object.entries(newConfig.providers).forEach(([providerKey, provider]) => {
            provider.limits.forEach(limit => {
                const isNew = typeof limit.id === 'string' && limit.id.startsWith('limit_')

                // Map UI fields to DB fields
                const row = {
                    provider: providerKey.charAt(0).toUpperCase() + providerKey.slice(1), // 'openai' -> 'Openai' (rough map)
                    // Better: use existing name or map known keys
                    tier_name: '', // Optional
                    model_pattern: limit.name, // UI Name is usually "GPT-4" etc. User types this.
                    reset_strategy: limit.resetType,
                    window_minutes: (limit.windowHours || 1) * 60,
                }

                // Handle Units
                if (limit.unit === 'tokens') {
                    row.token_limit = parseInt(limit.limit)
                    row.request_limit = null
                } else {
                    row.request_limit = parseInt(limit.limit)
                    row.token_limit = null
                }

                // Correct Provider Name capitalization if possible
                if (providerKey === 'chatgpt') row.provider = 'OpenAI' // Legacy mapping fix
                if (providerKey === 'openai') row.provider = 'OpenAI'
                if (providerKey === 'claude') row.provider = 'Anthropic'
                if (providerKey === 'anthropic') row.provider = 'Anthropic'
                if (providerKey === 'gemini') row.provider = 'Google'
                if (providerKey === 'google') row.provider = 'Google'

                if (!isNew) {
                    row.id = limit.id
                    keptIds.add(limit.id)
                }
                // else: let DB generate ID (don't send id field)

                upsertData.push(row)
            })
        })

        // 3. Delete removed limits
        const idsToDelete = [...existingIds].filter(id => !keptIds.has(id))

        if (idsToDelete.length > 0) {
            await supabase
                .from('rate_limit_configs')
                .delete()
                .in('id', idsToDelete)
        }

        // 4. Upsert changes
        if (upsertData.length > 0) {
            const { error } = await supabase
                .from('rate_limit_configs')
                .upsert(upsertData)

            if (error) console.error('Error saving limits:', error)
        }

    } catch (e) {
        console.error('Failed to save config:', e)
    }
}

/**
 * Reset all limits for a provider (both 5h and weekly)
 * Sets remaining to full limit and resets window_start to now
 */
export async function resetProviderLimits(providerName) {
    try {
        // Get all config IDs for this provider
        const { data: configs } = await supabase
            .from('rate_limit_configs')
            .select('id, token_limit, request_limit')
            .ilike('provider', providerName)

        if (!configs || configs.length === 0) return

        const now = new Date().toISOString()

        // Update each status to full remaining
        for (const conf of configs) {
            await supabase
                .from('rate_limit_status')
                .upsert({
                    config_id: conf.id,
                    remaining_tokens: conf.token_limit,
                    remaining_requests: conf.request_limit,
                    window_start: now,
                    next_reset: null, // Will be recalculated by collector
                    last_updated: now
                }, { onConflict: 'config_id' })
        }

        console.log(`Reset all limits for ${providerName}`)
    } catch (e) {
        console.error('Failed to reset limits:', e)
    }
}

// Helpers
export function getConfig() { return null }
export function setManualReset() { console.warn('Manual reset via DB only') }
export function getResetTimes() { return {} }

// Utils
export function getQuotaStatusColor(percentage) {
    if (percentage === null || percentage === undefined) return '#6b7280'
    if (percentage >= 50) return '#10b981' // Green (high remaining)
    if (percentage >= 20) return '#f59e0b' // Orange
    return '#ef4444' // Red
}

export function detectProvider(modelName) {
    if (modelName.includes('gpt') || modelName.includes('o1')) return 'openai'
    if (modelName.includes('claude')) return 'anthropic'
    if (modelName.includes('gemini')) return 'google'
    return 'unknown'
}

export function getUsageInWindow() { return 0; } // Deprecated by backendStatus
export function formatResetTime() { return ''; } // Deprecated
export function calculateLimitQuota() { return {}; } // Deprecated

export default {
    loadRateLimitsConfig,
    saveConfig,
    resetProviderLimits,
    getConfig,
    getResetTimes,
    setManualReset,
    clearManualReset: () => { },
    detectProvider,
    getWindowStart: () => 0,
    getUsageInWindow,
    formatResetTime,
    calculateLimitQuota,
    getQuotaStatusColor,
    getQuotaStatusLabel: () => '',
    getNextScheduledReset: () => new Date(),
    resetConfigToDefaults: () => { }
}
