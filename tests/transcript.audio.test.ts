import { describe, expect, it, vi } from 'vitest'

import * as audio from '../src/content/link-preview/transcript/providers/audio.js'
import type {
  ProviderContext,
  ProviderFetchOptions,
} from '../src/content/link-preview/transcript/types.js'

const contextFor = (url: string): ProviderContext => ({ url, html: null, resourceKey: null })

const baseOptions: ProviderFetchOptions = {
  fetch: vi.fn() as unknown as typeof fetch,
  apifyApiToken: null,
  youtubeTranscriptMode: 'auto',
  ytDlpPath: null,
  falApiKey: null,
  openaiApiKey: null,
}

describe('audio transcript provider', () => {
  describe('canHandle', () => {
    it('matches mp3 URLs', () => {
      expect(audio.canHandle(contextFor('https://example.com/podcast.mp3'))).toBe(true)
      expect(audio.canHandle(contextFor('https://cdn.example.com/audio/episode-123.mp3'))).toBe(
        true
      )
    })

    it('matches other audio formats', () => {
      expect(audio.canHandle(contextFor('https://example.com/audio.wav'))).toBe(true)
      expect(audio.canHandle(contextFor('https://example.com/audio.m4a'))).toBe(true)
      expect(audio.canHandle(contextFor('https://example.com/audio.aac'))).toBe(true)
      expect(audio.canHandle(contextFor('https://example.com/audio.ogg'))).toBe(true)
      expect(audio.canHandle(contextFor('https://example.com/audio.flac'))).toBe(true)
      expect(audio.canHandle(contextFor('https://example.com/audio.webm'))).toBe(true)
    })

    it('does not match non-audio URLs', () => {
      expect(audio.canHandle(contextFor('https://example.com/article'))).toBe(false)
      expect(audio.canHandle(contextFor('https://example.com/video.mp4'))).toBe(false)
      expect(audio.canHandle(contextFor('https://example.com/image.jpg'))).toBe(false)
      expect(audio.canHandle(contextFor('https://youtube.com/watch?v=abc'))).toBe(false)
    })

    it('handles case insensitivity', () => {
      expect(audio.canHandle(contextFor('https://example.com/audio.MP3'))).toBe(true)
      expect(audio.canHandle(contextFor('https://example.com/audio.Mp3'))).toBe(true)
    })

    it('handles URLs with query strings', () => {
      expect(audio.canHandle(contextFor('https://example.com/audio.mp3?token=abc'))).toBe(true)
    })

    it('handles invalid URLs gracefully', () => {
      expect(audio.canHandle(contextFor('not-a-url'))).toBe(false)
    })
  })

  describe('fetchTranscript', () => {
    it('returns error when no API keys provided', async () => {
      const result = await audio.fetchTranscript(
        contextFor('https://example.com/audio.mp3'),
        baseOptions
      )

      expect(result.text).toBeNull()
      expect(result.source).toBeNull()
      expect(result.notes).toContain('FAL_KEY or OPENAI_API_KEY required')
    })

    it('returns error when download fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))
      const options: ProviderFetchOptions = {
        ...baseOptions,
        fetch: mockFetch as unknown as typeof fetch,
        falApiKey: 'test-key',
      }

      const result = await audio.fetchTranscript(
        contextFor('https://example.com/audio.mp3'),
        options
      )

      expect(result.text).toBeNull()
      expect(result.notes).toContain('HTTP 404')
    })

    it('returns error when fetch throws', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      const options: ProviderFetchOptions = {
        ...baseOptions,
        fetch: mockFetch as unknown as typeof fetch,
        falApiKey: 'test-key',
      }

      const result = await audio.fetchTranscript(
        contextFor('https://example.com/audio.mp3'),
        options
      )

      expect(result.text).toBeNull()
      expect(result.notes).toContain('Network error')
    })
  })
})
