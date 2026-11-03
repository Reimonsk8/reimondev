import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const base = '/games/'
const outputDir = '../dist'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base,
    root: 'frontend',
    build: {
        outDir: outputDir,
        emptyOutDir: true,
    },
    server: {
        port: 3000,
    },
})
