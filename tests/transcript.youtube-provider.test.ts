import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  extractYoutubeiTranscriptConfig: vi.fn(),
  fetchTranscriptFromTranscriptEndpoint: vi.fn(),
}))
const captions = vi.hoisted(() => ({
  fetchTranscriptFromCaptionTracks: vi.fn(),
}))
const apify = vi.hoisted(() => ({
  fetchTranscriptWithApify: vi.fn(),
}))
const ytdlp = vi.hoisted(() => ({
  fetchTranscriptWithYtDlp: vi.fn(),
}))

vi.mock('../src/content/link-preview/transcript/providers/youtube/api.js', () => api)
vi.mock('../src/content/link-preview/transcript/providers/youtube/captions.js', () => captions)
vi.mock('../src/content/link-preview/transcript/providers/youtube/apify.js', () => apify)
vi.mock('../src/content/link-preview/transcript/providers/youtube/yt-dlp.js', () => ytdlp)

import { fetchTranscript } from '../src/content/link-preview/transcript/providers/youtube.js'

const baseOptions = {
  fetch: vi.fn() as unknown as typeof fetch,
  apifyApiToken: null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null,
  falApiKey: null,
  openaiApiKey: null,
}

describe('YouTube transcript provider module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.extractYoutubeiTranscriptConfig.mockReturnValue(null)
    api.fetchTranscriptFromTranscriptEndpoint.mockResolvedValue(null)
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue(null)
    apify.fetchTranscriptWithApify.mockResolvedValue(null)
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      text: null,
      provider: null,
      error: null,
      notes: [],
    })
  })

  it('returns null when HTML is missing or video id cannot be resolved', async () => {
    expect(
      await fetchTranscript(
        { url: 'https://www.youtube.com/watch?v=abcdefghijk', html: null, resourceKey: null },
        baseOptions
      )
    ).toEqual({ text: null, source: null, attemptedProviders: [] })

    expect(
      await fetchTranscript(
        { url: 'https://www.youtube.com/watch', html: '<html></html>', resourceKey: null },
        baseOptions
      )
    ).toEqual({ text: null, source: null, attemptedProviders: [] })
  })

  it('uses apify-only mode and skips web + yt-dlp', async () => {
    apify.fetchTranscriptWithApify.mockResolvedValue('Hello from apify')

    const result = await fetchTranscript(
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        html: '<html></html>',
        resourceKey: null,
      },
      {
        ...baseOptions,
        apifyApiToken: 'TOKEN',
        youtubeTranscriptMode: 'apify',
      }
    )

    expect(result.text).toBe('Hello from apify')
    expect(result.source).toBe('apify')
    expect(result.attemptedProviders).toEqual(['apify'])
    expect(api.extractYoutubeiTranscriptConfig).not.toHaveBeenCalled()
    expect(captions.fetchTranscriptFromCaptionTracks).not.toHaveBeenCalled()
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled()
  })

  it('uses web-only mode and skips apify + yt-dlp', async () => {
    const result = await fetchTranscript(
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        html: '<html></html>',
        resourceKey: null,
      },
      {
        ...baseOptions,
        apifyApiToken: 'TOKEN',
        youtubeTranscriptMode: 'web',
      }
    )

    expect(result.source).toBe('unavailable')
    expect(result.attemptedProviders).toEqual(['captionTracks', 'unavailable'])
    expect(apify.fetchTranscriptWithApify).not.toHaveBeenCalled()
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled()
  })

  it('attempts providers in order for auto mode', async () => {
    api.extractYoutubeiTranscriptConfig.mockReturnValue({
      apiKey: 'KEY',
      context: {},
      params: 'PARAMS',
    })

    const result = await fetchTranscript(
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        html: '<html></html>',
        resourceKey: null,
      },
      {
        ...baseOptions,
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
        openaiApiKey: 'OPENAI',
      }
    )

    expect(result.attemptedProviders).toEqual([
      'youtubei',
      'captionTracks',
      'apify',
      'yt-dlp',
      'unavailable',
    ])
  })

  it('skips yt-dlp in auto mode when credentials are missing', async () => {
    api.extractYoutubeiTranscriptConfig.mockReturnValue(null)

    const result = await fetchTranscript(
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        html: '<html></html>',
        resourceKey: null,
      },
      {
        ...baseOptions,
        youtubeTranscriptMode: 'auto',
      }
    )

    expect(result.attemptedProviders).toEqual(['captionTracks', 'apify', 'unavailable'])
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled()
  })

  it('errors in yt-dlp mode when transcription keys are missing', async () => {
    await expect(
      fetchTranscript(
        {
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          html: '<html></html>',
          resourceKey: null,
        },
        {
          ...baseOptions,
          youtubeTranscriptMode: 'yt-dlp',
          ytDlpPath: '/usr/bin/yt-dlp',
          falApiKey: null,
          openaiApiKey: null,
        }
      )
    ).rejects.toThrow('Missing OPENAI_API_KEY or FAL_KEY')
  })

  it('errors in yt-dlp mode when YT_DLP_PATH is missing', async () => {
    await expect(
      fetchTranscript(
        {
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          html: '<html></html>',
          resourceKey: null,
        },
        {
          ...baseOptions,
          youtubeTranscriptMode: 'yt-dlp',
          ytDlpPath: null,
          openaiApiKey: 'KEY',
        }
      )
    ).rejects.toThrow('Missing YT_DLP_PATH')
  })

  it('throws yt-dlp error in yt-dlp mode when no transcript available', async () => {
    const mockError = new Error('yt-dlp failed to download')
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      text: null,
      provider: null,
      error: mockError,
      notes: [],
    })

    await expect(
      fetchTranscript(
        {
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          html: '<html></html>',
          resourceKey: null,
        },
        {
          ...baseOptions,
          youtubeTranscriptMode: 'yt-dlp',
          ytDlpPath: '/usr/bin/yt-dlp',
          openaiApiKey: 'KEY',
        }
      )
    ).rejects.toThrow('yt-dlp failed to download')
  })

  it('errors in manual mode when yt-dlp fallback is not configured', async () => {
    await expect(
      fetchTranscript(
        {
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          html: '<html></html>',
          resourceKey: null,
        },
        {
          ...baseOptions,
          youtubeTranscriptMode: 'manual',
          ytDlpPath: null,
          openaiApiKey: 'KEY',
        }
      )
    ).rejects.toThrow('--youtube manual requires YT_DLP_PATH')
  })

  it('uses manual mode with skipAutoGenerated flag', async () => {
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue('Manual transcript')

    const result = await fetchTranscript(
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        html: '<html></html>',
        resourceKey: null,
      },
      {
        ...baseOptions,
        youtubeTranscriptMode: 'manual',
        ytDlpPath: '/usr/bin/yt-dlp',
        openaiApiKey: 'KEY',
      }
    )

    expect(result.text).toBe('Manual transcript')
    expect(result.source).toBe('captionTracks')
    expect(captions.fetchTranscriptFromCaptionTracks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipAutoGenerated: true })
    )
    // apify should not be called in manual mode
    expect(apify.fetchTranscriptWithApify).not.toHaveBeenCalled()
  })

  it('falls back to yt-dlp when manual captions not found', async () => {
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue(null)
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      text: 'Transcribed audio',
      provider: 'openai',
      error: null,
      notes: ['No manual captions found, using yt-dlp transcription'],
    })

    const result = await fetchTranscript(
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        html: '<html></html>',
        resourceKey: null,
      },
      {
        ...baseOptions,
        youtubeTranscriptMode: 'manual',
        ytDlpPath: '/usr/bin/yt-dlp',
        openaiApiKey: 'KEY',
      }
    )

    expect(result.text).toBe('Transcribed audio')
    expect(result.source).toBe('yt-dlp')
    expect(result.attemptedProviders).toEqual(['captionTracks', 'yt-dlp'])
    expect(result.notes).toContain('No manual captions found, using yt-dlp transcription')
    expect(apify.fetchTranscriptWithApify).not.toHaveBeenCalled()
  })

  it('includes notes from yt-dlp result in auto mode', async () => {
    api.extractYoutubeiTranscriptConfig.mockReturnValue(null)
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue(null)
    apify.fetchTranscriptWithApify.mockResolvedValue(null)
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      text: 'Transcribed content',
      provider: 'fal',
      error: null,
      notes: ['Using FAL AI for transcription'],
    })

    const result = await fetchTranscript(
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        html: '<html></html>',
        resourceKey: null,
      },
      {
        ...baseOptions,
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
        falApiKey: 'FAL_KEY',
      }
    )

    expect(result.text).toBe('Transcribed content')
    expect(result.source).toBe('yt-dlp')
    expect(result.notes).toBe('Using FAL AI for transcription')
  })
})
