import { createFalClient } from '@fal-ai/client'

const TRANSCRIPTION_TIMEOUT_MS = 600_000

export type TranscriptionProvider = 'openai' | 'fal'

export type TranscribeResult = {
  text: string | null
  provider: TranscriptionProvider | null
  error: Error | null
  notes: string[]
}

export type TranscribeOptions = {
  openaiApiKey: string | null
  falApiKey: string | null
}

/**
 * Transcribe audio bytes using OpenAI or FAL Whisper.
 * Tries OpenAI first if available, falls back to FAL.
 */
export const transcribeAudio = async (
  audioBytes: ArrayBuffer,
  { falApiKey, openaiApiKey }: TranscribeOptions
): Promise<TranscribeResult> => {
  const notes: string[] = []

  if (!openaiApiKey && !falApiKey) {
    return {
      text: null,
      provider: null,
      error: new Error('OPENAI_API_KEY or FAL_KEY is required for transcription'),
      notes,
    }
  }

  // Try OpenAI first
  let openaiError: Error | null = null
  if (openaiApiKey) {
    try {
      const text = await transcribeWithOpenAi(audioBytes, openaiApiKey)
      if (text) {
        return { text, provider: 'openai', error: null, notes }
      }
      openaiError = new Error('OpenAI transcription returned empty text')
    } catch (error) {
      openaiError = wrapError('OpenAI transcription failed', error)
    }
  }

  if (openaiError && falApiKey) {
    notes.push(`OpenAI transcription failed; falling back to FAL: ${openaiError.message}`)
  }

  // Fall back to FAL
  if (falApiKey) {
    try {
      const text = await transcribeWithFal(audioBytes, falApiKey)
      if (text) {
        return { text, provider: 'fal', error: null, notes }
      }
      return {
        text: null,
        provider: 'fal',
        error: new Error('FAL transcription returned empty text'),
        notes,
      }
    } catch (error) {
      return {
        text: null,
        provider: 'fal',
        error: wrapError('FAL transcription failed', error),
        notes,
      }
    }
  }

  return {
    text: null,
    provider: openaiApiKey ? 'openai' : null,
    error: openaiError ?? new Error('No transcription providers available'),
    notes,
  }
}

export async function transcribeWithOpenAi(
  audioBytes: ArrayBuffer,
  apiKey: string
): Promise<string | null> {
  const form = new FormData()
  form.append('file', new Blob([audioBytes], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', 'whisper-1')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    const suffix = detail ? `: ${detail}` : ''
    throw new Error(`OpenAI transcription failed (${response.status})${suffix}`)
  }

  const payload = (await response.json()) as { text?: unknown }
  if (typeof payload?.text !== 'string') return null
  const trimmed = payload.text.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function transcribeWithFal(
  audioBytes: ArrayBuffer,
  apiKey: string
): Promise<string | null> {
  const fal = createFalClient({ credentials: apiKey })
  const audioUrl = await fal.storage.upload(new Blob([audioBytes], { type: 'audio/mpeg' }))

  const result = await Promise.race([
    fal.subscribe('fal-ai/wizper', {
      input: { audio_url: audioUrl, language: 'en' },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('FAL transcription timeout')), TRANSCRIPTION_TIMEOUT_MS)
    ),
  ])

  return extractText(result)
}

export function extractText(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const data = 'data' in result ? (result as { data: unknown }).data : result
  if (typeof data !== 'object' || data === null) return null
  if ('text' in data && typeof (data as { text: unknown }).text === 'string') {
    const text = (data as { text: string }).text.trim()
    return text.length > 0 ? text : null
  }
  if ('chunks' in data && Array.isArray((data as { chunks: unknown }).chunks)) {
    const chunks = (data as { chunks: unknown[] }).chunks
    const lines: string[] = []
    for (const chunk of chunks) {
      if (typeof chunk === 'object' && chunk !== null && 'text' in chunk) {
        const text = (chunk as { text: unknown }).text
        if (typeof text === 'string' && text.trim()) {
          lines.push(text.trim())
        }
      }
    }
    return lines.length > 0 ? lines.join(' ') : null
  }
  return null
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text()
    const trimmed = text.trim()
    if (!trimmed) return null
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed
  } catch {
    return null
  }
}

function wrapError(prefix: string, error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`${prefix}: ${error.message}`, { cause: error })
  }
  return new Error(`${prefix}: ${String(error)}`)
}
