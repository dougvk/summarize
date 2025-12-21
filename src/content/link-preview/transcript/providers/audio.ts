import { transcribeAudio } from '../transcribe.js'
import type { ProviderContext, ProviderFetchOptions, ProviderResult } from '../types.js'

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm']
const DOWNLOAD_TIMEOUT_MS = 120_000

/**
 * Check if URL points directly to an audio file based on extension.
 */
export const canHandle = ({ url }: ProviderContext): boolean => {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    return AUDIO_EXTENSIONS.some((ext) => pathname.endsWith(ext))
  } catch {
    return false
  }
}

/**
 * Download audio from URL and transcribe using FAL or OpenAI Whisper.
 */
export const fetchTranscript = async (
  context: ProviderContext,
  options: ProviderFetchOptions
): Promise<ProviderResult> => {
  const { url } = context
  const { fetch: fetchFn, falApiKey, openaiApiKey } = options

  if (!falApiKey && !openaiApiKey) {
    return {
      text: null,
      source: null,
      attemptedProviders: ['audio-fal', 'audio-openai'],
      notes: 'No transcription API key available (FAL_KEY or OPENAI_API_KEY required)',
    }
  }

  // Download audio file
  let audioBytes: ArrayBuffer
  try {
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })

    if (!response.ok) {
      return {
        text: null,
        source: null,
        attemptedProviders: ['audio-fal'],
        notes: `Failed to download audio: HTTP ${response.status}`,
      }
    }

    audioBytes = await response.arrayBuffer()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      text: null,
      source: null,
      attemptedProviders: ['audio-fal'],
      notes: `Failed to download audio: ${message}`,
    }
  }

  // Transcribe
  const result = await transcribeAudio(audioBytes, { falApiKey, openaiApiKey })

  const attemptedProviders: ProviderResult['attemptedProviders'] = []
  if (falApiKey) attemptedProviders.push('audio-fal')
  if (openaiApiKey) attemptedProviders.push('audio-openai')

  if (result.error) {
    return {
      text: null,
      source: null,
      attemptedProviders,
      notes: result.notes.length > 0 ? result.notes.join('; ') : result.error.message,
    }
  }

  const source = result.provider === 'fal' ? 'audio-fal' : 'audio-openai'

  return {
    text: result.text,
    source: result.text ? source : null,
    attemptedProviders,
    notes: result.notes.length > 0 ? result.notes.join('; ') : null,
  }
}
