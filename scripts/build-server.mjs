import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const distDir = path.join(repoRoot, 'dist')
await mkdir(distDir, { recursive: true })

await build({
  entryPoints: [path.join(repoRoot, 'src', 'server.ts')],
  outfile: path.join(distDir, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  // Keep core dependencies external for smaller bundle
  external: ['cheerio', 'es-toolkit', 'sanitize-html', 'fastify'],
})
