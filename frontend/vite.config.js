import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            // PostgREST — proxied by nginx in prod, proxied by Vite in dev
            // Strip Authorization/apikey headers: PostgREST uses web_anon role when no JWT present
            '/rest/v1': {
                target: 'http://localhost:3000',
                rewrite: (path) => path.replace(/^\/rest\/v1/, ''),
                changeOrigin: true,
                configure: (proxy) => {
                    proxy.on('proxyReq', (proxyReq) => {
                        proxyReq.removeHeader('Authorization')
                        proxyReq.removeHeader('apikey')
                    })
                },
            },
            // Collector trigger API
            '/api/collector': {
                target: 'http://localhost:5001',
                changeOrigin: true,
            },
        }
    },
    build: {
        outDir: 'dist',
        sourcemap: false
    }
})
