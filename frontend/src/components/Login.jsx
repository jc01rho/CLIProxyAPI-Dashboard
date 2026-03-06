import { useState, useEffect } from 'react'

export default function Login({ onLogin, authEnabled }) {
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const response = await fetch('/api/collector/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            })

            const data = await response.json()

            if (response.ok) {
                localStorage.setItem('auth_token', data.token)
                localStorage.setItem('auth_expires', data.expires)
                onLogin(data.token)
            } else {
                setError(data.error || 'Login failed')
            }
        } catch (err) {
            setError('Connection error. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
            color: '#fff'
        }}>
            <div style={{
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                borderRadius: '16px',
                padding: '40px',
                width: '100%',
                maxWidth: '400px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <h1 style={{ 
                        fontSize: '28px', 
                        fontWeight: '700',
                        margin: '0 0 8px 0',
                        background: 'linear-gradient(90deg, #4facfe 0%, #00f2fe 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}>
                        CLIProxy Dashboard
                    </h1>
                    <p style={{ color: 'rgba(255, 255, 255, 0.6)', margin: 0 }}>
                        Enter password to access
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '20px' }}>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password"
                            autoFocus
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: '14px 16px',
                                fontSize: '16px',
                                border: '2px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '8px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: '#fff',
                                outline: 'none',
                                boxSizing: 'border-box',
                                transition: 'border-color 0.2s'
                            }}
                            onFocus={(e) => e.target.style.borderColor = '#4facfe'}
                            onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                        />
                    </div>

                    {error && (
                        <div style={{
                            color: '#ff6b6b',
                            background: 'rgba(255, 107, 107, 0.1)',
                            padding: '12px',
                            borderRadius: '8px',
                            marginBottom: '20px',
                            fontSize: '14px'
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !password}
                        style={{
                            width: '100%',
                            padding: '14px',
                            fontSize: '16px',
                            fontWeight: '600',
                            border: 'none',
                            borderRadius: '8px',
                            background: loading || !password 
                                ? 'rgba(79, 172, 254, 0.3)' 
                                : 'linear-gradient(90deg, #4facfe 0%, #00f2fe 100%)',
                            color: '#fff',
                            cursor: loading || !password ? 'not-allowed' : 'pointer',
                            transition: 'transform 0.2s, box-shadow 0.2s'
                        }}
                    >
                        {loading ? 'Logging in...' : 'Login'}
                    </button>
                </form>

                {!authEnabled && (
                    <p style={{
                        textAlign: 'center',
                        marginTop: '20px',
                        color: 'rgba(255, 255, 255, 0.4)',
                        fontSize: '13px'
                    }}>
                        Authentication not configured on server
                    </p>
                )}
            </div>
        </div>
    )
}
