// Starts the FastAPI backend with the virtual environment's Python,
// picking the right path for Windows vs macOS/Linux.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendDir = path.join(root, 'src', 'backend')
const python = process.platform === 'win32'
  ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
  : path.join(backendDir, '.venv', 'bin', 'python')

if (!existsSync(python)) {
  console.error(`Python virtual environment not found at ${python}`)
  console.error('Create it first (see "One-time setup" in README.md).')
  process.exit(1)
}

const child = spawn(
  python,
  ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000', '--app-dir', backendDir],
  { cwd: root, stdio: 'inherit' },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code) => process.exit(code ?? 0))
