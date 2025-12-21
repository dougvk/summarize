/**
 * HTTP server wrapper for summarize CLI.
 * Exposes POST /extract endpoint for content extraction.
 */

import Fastify from 'fastify'
import { runCli } from './run.js'

const app = Fastify({ logger: true })

interface ExtractRequest {
  url: string
  timeout_ms?: number
  firecrawl?: 'auto' | 'always' | 'off'
  youtube?: 'auto' | 'web' | 'yt-dlp' | 'apify'
}

interface ExtractedContent {
  url: string
  title: string | null
  description: string | null
  siteName: string | null
  content: string
  truncated: boolean
  totalCharacters: number
  wordCount: number
  transcriptCharacters: number | null
  transcriptLines: number | null
  transcriptSource: string | null
}

interface ExtractResponse {
  success: boolean
  extracted: ExtractedContent | null
  error?: {
    code: string
    message: string
    transient: boolean
  }
  duration_ms: number
}

function isTransientError(message: string): boolean {
  const msg = message.toLowerCase()
  return (
    msg.includes('timeout') ||
    msg.includes('rate limit') ||
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('etimedout')
  )
}

function getErrorCode(message: string): string {
  const msg = message.toLowerCase()
  if (msg.includes('timeout') || msg.includes('etimedout')) return 'TIMEOUT'
  if (msg.includes('rate limit')) return 'RATE_LIMIT'
  if (msg.includes('unsupported')) return 'UNSUPPORTED_TYPE'
  if (msg.includes('not found') || msg.includes('404')) return 'NOT_FOUND'
  if (msg.includes('403') || msg.includes('forbidden')) return 'FORBIDDEN'
  return 'EXTRACTION_FAILED'
}

app.post<{ Body: ExtractRequest }>('/extract', async (request, reply) => {
  const startTime = Date.now()
  const { url, timeout_ms, firecrawl, youtube } = request.body

  if (!url) {
    return reply.status(400).send({
      success: false,
      extracted: null,
      error: {
        code: 'MISSING_URL',
        message: 'url is required',
        transient: false,
      },
      duration_ms: Date.now() - startTime,
    })
  }

  try {
    // Build CLI args
    const args = [url, '--extract-only', '--json']
    if (timeout_ms) args.push('--timeout', `${timeout_ms}ms`)
    if (firecrawl) args.push('--firecrawl', firecrawl)
    if (youtube) args.push('--youtube', youtube)

    // Capture stdout
    let output = ''
    const stdout = {
      write: (chunk: string | Buffer): boolean => {
        output += chunk.toString()
        return true
      },
    } as unknown as NodeJS.WritableStream

    const stderr = {
      write: (): boolean => true,
    } as unknown as NodeJS.WritableStream

    await runCli(args, {
      env: process.env as Record<string, string | undefined>,
      fetch: globalThis.fetch,
      stdout,
      stderr,
    })

    // Parse the JSON output
    const result = JSON.parse(output.trim())

    // Map to our response format
    const extracted = result.extracted
    if (!extracted) {
      return {
        success: false,
        extracted: null,
        error: {
          code: 'NO_CONTENT',
          message: 'No content extracted',
          transient: false,
        },
        duration_ms: Date.now() - startTime,
      }
    }

    const response: ExtractResponse = {
      success: true,
      extracted: {
        url: extracted.url || url,
        title: extracted.title || null,
        description: extracted.description || null,
        siteName: extracted.siteName || null,
        content: extracted.content || '',
        truncated: extracted.truncated || false,
        totalCharacters: extracted.totalCharacters || 0,
        wordCount: extracted.wordCount || 0,
        transcriptCharacters: extracted.transcriptCharacters || null,
        transcriptLines: extracted.transcriptLines || null,
        transcriptSource: extracted.transcriptSource || null,
      },
      duration_ms: Date.now() - startTime,
    }

    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isTransient = isTransientError(message)

    return {
      success: false,
      extracted: null,
      error: {
        code: getErrorCode(message),
        message,
        transient: isTransient,
      },
      duration_ms: Date.now() - startTime,
    }
  }
})

app.get('/health', async () => ({ status: 'ok' }))
app.get('/ready', async () => ({ status: 'ready' }))

const port = parseInt(process.env.PORT || '3100', 10)
const host = process.env.HOST || '0.0.0.0'

app.listen({ port, host }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`Server listening at ${address}`)
})
