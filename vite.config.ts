import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The extension bridge and backend trust this development port.
  server: { port: 5173, strictPort: true },
})
