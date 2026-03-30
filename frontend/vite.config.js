import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

const devBypassAuth = String(process.env.VITE_DEV_BYPASS_AUTH || '').toLowerCase() === 'true'
const databaseProvider = String(process.env.DATABASE_PROVIDER || process.env.VITE_DATABASE_PROVIDER || 'local').toLowerCase()

const authBypassPaths = new Set([
    '/api/collector/health',
    '/api/collector/auth/login',
    '/api/collector/auth/session',
    '/api/collector/auth/logout',
    '/api/collector/auth/verify',
    '/api/collector/log-events',
    '/api/collector/skill-events',
])

export default defineConfig({
    plugins: [react()],
    define: {
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            // PostgREST — proxied by nginx in prod, and gated via collector auth in dev
            ...(databaseProvider === 'local' ? {
            '/rest/v1': {
                target: `http://localhost:${process.env.POSTGREST_HOST_PORT || '8418'}`,
                rewrite: (path) => path.replace(/^\/rest\/v1/, ''),
                changeOrigin: true,
                configure: (proxy) => {
                    proxy.on('proxyReq', async (proxyReq, req, res) => {
                        proxyReq.removeHeader('Authorization')
                        proxyReq.removeHeader('apikey')

                        if (devBypassAuth) {
                            return
                        }

                        try {
                            const cookie = req.headers.cookie || ''
                            const verifyResponse = await fetch('http://localhost:5001/api/collector/auth/verify', {
                                headers: cookie ? { cookie } : {},
                            })

                            if (verifyResponse.status === 401) {
                                if (!res.headersSent) {
                                    res.writeHead(401, { 'Content-Type': 'application/json' })
                                    res.end(JSON.stringify({ error: 'authentication required' }))
                                }
                                proxyReq.destroy()
                            }
                        } catch (error) {
                            if (!res.headersSent) {
                                res.writeHead(502, { 'Content-Type': 'application/json' })
                                res.end(JSON.stringify({ error: 'auth verify failed' }))
                            }
                            proxyReq.destroy(error)
                        }
                    })
                },
            },
            } : {}),
            // Collector API — keep cookie/session semantics same as production
            '/api/collector': {
                target: 'http://localhost:5001',
                changeOrigin: true,
                configure: (proxy) => {
                    proxy.on('proxyReq', async (proxyReq, req, res) => {
                        if (devBypassAuth || authBypassPaths.has(req.url || '')) {
                            return
                        }

                        try {
                            const cookie = req.headers.cookie || ''
                            const verifyResponse = await fetch('http://localhost:5001/api/collector/auth/verify', {
                                headers: cookie ? { cookie } : {},
                            })

                            if (verifyResponse.status === 401) {
                                if (!res.headersSent) {
                                    res.writeHead(401, { 'Content-Type': 'application/json' })
                                    res.end(JSON.stringify({ error: 'authentication required' }))
                                }
                                proxyReq.destroy()
                            }
                        } catch (error) {
                            if (!res.headersSent) {
                                res.writeHead(502, { 'Content-Type': 'application/json' })
                                res.end(JSON.stringify({ error: 'auth verify failed' }))
                            }
                            proxyReq.destroy(error)
                        }
                    })
                },
            },
        }
    },
    build: {
        outDir: 'dist',
        sourcemap: false
    }
})
