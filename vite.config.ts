import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Listen on all interfaces so both localhost and 127.0.0.1 work.
  // The extension bridge and backend trust this development port.
  server: { host: true, port: 5173, strictPort: true },
})
