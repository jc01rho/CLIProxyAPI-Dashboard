import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [isDarkMode, setIsDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('theme')
            if (saved) return saved === 'dark'
            return true
        }
        return true
    })

    const handleLogin = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password
        })

        if (error) {
            setError(error.message)
        }
        setLoading(false)
    }

    const toggleTheme = () => {
        setIsDarkMode(prev => {
            const newValue = !prev
            localStorage.setItem('theme', newValue ? 'dark' : 'light')
            return newValue
        })
    }

    return (
        <div className={`auth-container ${isDarkMode ? 'dark' : 'light'}`} style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDarkMode 
                ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' 
                : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        }}>
            <div style={{
                background: isDarkMode ? 'rgba(30, 41, 59, 0.8)' : 'rgba(255, 255, 255, 0.95)',
                borderRadius: '16px',
                padding: '40px',
                width: '100%',
                maxWidth: '400px',
                boxShadow: isDarkMode 
                    ? '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)' 
                    : '0 25px 50px -12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)',
                backdropFilter: 'blur(12px)'
            }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        marginBottom: '8px'
                    }}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3b82f6" width="32" height="32">
                            <path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75zM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 01-1.875-1.875V8.625zM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 013 19.875v-6.75z" />
                        </svg>
                        <h1 style={{
                            fontSize: '24px',
                            fontWeight: '700',
                            color: isDarkMode ? '#f8fafc' : '#0f172a',
                            margin: 0
                        }}>
                            CLIProxy Dashboard
                        </h1>
                    </div>
                    <p style={{
                        color: isDarkMode ? '#94a3b8' : '#64748b',
                        fontSize: '14px',
                        margin: 0
                    }}>
                        Sign in to continue
                    </p>
                </div>

                {/* Login Form */}
                <form onSubmit={handleLogin}>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: isDarkMode ? '#cbd5e1' : '#475569'
                        }}>
                            Email
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="your@email.com"
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                borderRadius: '10px',
                                border: `1px solid ${isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(0, 0, 0, 0.1)'}`,
                                background: isDarkMode ? 'rgba(15, 23, 42, 0.5)' : '#ffffff',
                                color: isDarkMode ? '#f8fafc' : '#0f172a',
                                fontSize: '15px',
                                outline: 'none',
                                transition: 'border-color 0.2s, box-shadow 0.2s',
                                boxSizing: 'border-box'
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = '#3b82f6'
                                e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.2)'
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(0, 0, 0, 0.1)'
                                e.target.style.boxShadow = 'none'
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: '24px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: isDarkMode ? '#cbd5e1' : '#475569'
                        }}>
                            Password
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                borderRadius: '10px',
                                border: `1px solid ${isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(0, 0, 0, 0.1)'}`,
                                background: isDarkMode ? 'rgba(15, 23, 42, 0.5)' : '#ffffff',
                                color: isDarkMode ? '#f8fafc' : '#0f172a',
                                fontSize: '15px',
                                outline: 'none',
                                transition: 'border-color 0.2s, box-shadow 0.2s',
                                boxSizing: 'border-box'
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = '#3b82f6'
                                e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.2)'
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(0, 0, 0, 0.1)'
                                e.target.style.boxShadow = 'none'
                            }}
                        />
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div style={{
                            padding: '12px 16px',
                            borderRadius: '10px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            color: '#ef4444',
                            fontSize: '14px',
                            marginBottom: '20px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                            </svg>
                            {error}
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            width: '100%',
                            padding: '14px',
                            borderRadius: '10px',
                            border: 'none',
                            background: loading ? '#64748b' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            color: '#ffffff',
                            fontSize: '15px',
                            fontWeight: '600',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            transition: 'transform 0.2s, box-shadow 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            boxShadow: loading ? 'none' : '0 4px 14px 0 rgba(59, 130, 246, 0.4)'
                        }}
                        onMouseOver={(e) => {
                            if (!loading) {
                                e.target.style.transform = 'translateY(-1px)'
                                e.target.style.boxShadow = '0 6px 20px 0 rgba(59, 130, 246, 0.5)'
                            }
                        }}
                        onMouseOut={(e) => {
                            e.target.style.transform = 'translateY(0)'
                            e.target.style.boxShadow = loading ? 'none' : '0 4px 14px 0 rgba(59, 130, 246, 0.4)'
                        }}
                    >
                        {loading ? (
                            <>
                                <div style={{
                                    width: '18px',
                                    height: '18px',
                                    border: '2px solid rgba(255, 255, 255, 0.3)',
                                    borderTopColor: '#ffffff',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite'
                                }} />
                                Signing in...
                            </>
                        ) : (
                            'Sign in'
                        )}
                    </button>
                </form>

                {/* Theme Toggle */}
                <div style={{
                    marginTop: '24px',
                    textAlign: 'center'
                }}>
                    <button
                        onClick={toggleTheme}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: isDarkMode ? '#64748b' : '#94a3b8',
                            fontSize: '13px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        {isDarkMode ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                                <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.06l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 001.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06l-1.06-1.06a.75.75 0 10-1.06 1.06l1.06 1.06z" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                                <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z" clipRule="evenodd" />
                            </svg>
                        )}
                        {isDarkMode ? 'Light mode' : 'Dark mode'}
                    </button>
                </div>
            </div>

            {/* CSS Animation for spinner */}
            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    )
}
