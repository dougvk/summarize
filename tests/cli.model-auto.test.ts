import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { runCli } from '../src/run.js'

const generateTextMock = vi.fn(async () => ({
  text: 'OK',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
}))
const createOpenAIMock = vi.fn(({ apiKey }: { apiKey: string }) => {
  const chatModel = (modelId: string) => ({ kind: 'chat', provider: 'openai', modelId, apiKey })
  return Object.assign(
    (modelId: string) => ({ kind: 'responses', provider: 'openai', modelId, apiKey }),
    { chat: chatModel }
  )
})

vi.mock('ai', () => ({
  generateText: generateTextMock,
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: createOpenAIMock,
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => (_modelId: string) => ({}),
}))

vi.mock('@ai-sdk/xai', () => ({
  createXai: () => (_modelId: string) => ({}),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => (_modelId: string) => ({}),
}))

const noopStream = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })

function collectStderr() {
  let text = ''
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString()
      callback()
    },
  })
  return { stderr, getText: () => text }
}

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html' },
  })

describe('cli --model auto', () => {
  it('errors when --model auto is set without OPENROUTER_API_KEY', async () => {
    const html = `<!doctype html><html><head><title>Ok</title></head><body><article><p>${'A'.repeat(
      260
    )}</p></article></body></html>`

    await expect(
      runCli(['--model', 'auto', '--timeout', '2s', 'https://example.com'], {
        env: {},
        fetch: vi.fn(async () => htmlResponse(html)) as unknown as typeof fetch,
        stdout: noopStream(),
        stderr: noopStream(),
      })
    ).rejects.toThrow(/--model auto requires OPENROUTER_API_KEY/)
  })

  it('selects small model for small inputs with default config', async () => {
    generateTextMock.mockClear()
    createOpenAIMock.mockClear()

    // Small content (under 95K tokens)
    const html = `<!doctype html><html><head><title>Test</title></head><body><article><p>${'Hello world. '.repeat(
      100
    )}</p></article></body></html>`

    const stderrCollector = collectStderr()

    await runCli(['--model', 'auto', '--timeout', '2s', '--verbose', 'https://example.com'], {
      env: { OPENROUTER_API_KEY: 'test-key' },
      fetch: vi.fn(async () => htmlResponse(html)) as unknown as typeof fetch,
      stdout: noopStream(),
      stderr: stderrCollector.stderr,
    })

    expect(generateTextMock).toHaveBeenCalledTimes(1)
    // Verify verbose output shows model selection
    const stderrText = stderrCollector.getText()
    expect(stderrText).toContain('auto model:')
    expect(stderrText).toContain('openai/gpt-oss-20b')
    expect(stderrText).toContain('groq')
  })

  it('selects large model when input exceeds small threshold', async () => {
    generateTextMock.mockClear()
    createOpenAIMock.mockClear()

    // Use custom thresholds to make testing easier
    const html = `<!doctype html><html><head><title>Test</title></head><body><article><p>${'Hello world. '.repeat(
      100
    )}</p></article></body></html>`

    const stderrCollector = collectStderr()

    await runCli(['--model', 'auto', '--timeout', '2s', '--verbose', 'https://example.com'], {
      env: {
        OPENROUTER_API_KEY: 'test-key',
        // Set very low threshold so our content exceeds it
        OPENROUTER_THRESHOLD_SMALL: '10',
        // Use openai model for large so we don't need GEMINI_API_KEY
        OPENROUTER_MODEL_LARGE: 'openai/gpt-4-turbo',
        OPENROUTER_PROVIDERS_LARGE: 'openai,azure',
      },
      fetch: vi.fn(async () => htmlResponse(html)) as unknown as typeof fetch,
      stdout: noopStream(),
      stderr: stderrCollector.stderr,
    })

    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const stderrText = stderrCollector.getText()
    expect(stderrText).toContain('auto model:')
    expect(stderrText).toContain('openai/gpt-4-turbo')
    expect(stderrText).toContain('openai,azure')
  })

  it('errors when input exceeds max threshold', async () => {
    // Use custom thresholds to trigger max exceeded error
    const html = `<!doctype html><html><head><title>Test</title></head><body><article><p>${'Hello world. '.repeat(
      100
    )}</p></article></body></html>`

    await expect(
      runCli(['--model', 'auto', '--timeout', '2s', 'https://example.com'], {
        env: {
          OPENROUTER_API_KEY: 'test-key',
          // Set very low max so our content exceeds it
          OPENROUTER_THRESHOLD_MAX: '10',
        },
        fetch: vi.fn(async () => htmlResponse(html)) as unknown as typeof fetch,
        stdout: noopStream(),
        stderr: noopStream(),
      })
    ).rejects.toThrow(/exceeds max context/)
  })

  it('uses custom models from environment variables', async () => {
    generateTextMock.mockClear()
    createOpenAIMock.mockClear()

    const html = `<!doctype html><html><head><title>Test</title></head><body><article><p>${'Hello world. '.repeat(
      100
    )}</p></article></body></html>`

    const stderrCollector = collectStderr()

    await runCli(['--model', 'auto', '--timeout', '2s', '--verbose', 'https://example.com'], {
      env: {
        OPENROUTER_API_KEY: 'test-key',
        // Use valid provider prefix (openai/) for custom model names
        OPENROUTER_MODEL_SMALL: 'openai/custom-small-model',
        OPENROUTER_PROVIDERS_SMALL: 'custom-provider',
      },
      fetch: vi.fn(async () => htmlResponse(html)) as unknown as typeof fetch,
      stdout: noopStream(),
      stderr: stderrCollector.stderr,
    })

    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const stderrText = stderrCollector.getText()
    expect(stderrText).toContain('openai/custom-small-model')
    expect(stderrText).toContain('custom-provider')
  })

  it('uses custom large model and providers when threshold exceeded', async () => {
    generateTextMock.mockClear()
    createOpenAIMock.mockClear()

    const html = `<!doctype html><html><head><title>Test</title></head><body><article><p>${'Hello world. '.repeat(
      100
    )}</p></article></body></html>`

    const stderrCollector = collectStderr()

    await runCli(['--model', 'auto', '--timeout', '2s', '--verbose', 'https://example.com'], {
      env: {
        OPENROUTER_API_KEY: 'test-key',
        OPENROUTER_THRESHOLD_SMALL: '10', // Force large model
        // Use valid provider prefix (openai/) for custom model names
        OPENROUTER_MODEL_LARGE: 'openai/custom-large-model',
        OPENROUTER_PROVIDERS_LARGE: 'provider-a,provider-b',
      },
      fetch: vi.fn(async () => htmlResponse(html)) as unknown as typeof fetch,
      stdout: noopStream(),
      stderr: stderrCollector.stderr,
    })

    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const stderrText = stderrCollector.getText()
    expect(stderrText).toContain('openai/custom-large-model')
    expect(stderrText).toContain('provider-a,provider-b')
  })

  it('parses comma-separated providers correctly', async () => {
    generateTextMock.mockClear()
    createOpenAIMock.mockClear()

    const html = `<!doctype html><html><head><title>Test</title></head><body><article><p>${'Hello world. '.repeat(
      100
    )}</p></article></body></html>`

    const stderrCollector = collectStderr()

    await runCli(['--model', 'auto', '--timeout', '2s', '--verbose', 'https://example.com'], {
      env: {
        OPENROUTER_API_KEY: 'test-key',
        // Include spaces in the list to test trimming
        OPENROUTER_PROVIDERS_SMALL: 'groq, clarifai/fp4 , google-vertex',
      },
      fetch: vi.fn(async () => htmlResponse(html)) as unknown as typeof fetch,
      stdout: noopStream(),
      stderr: stderrCollector.stderr,
    })

    const stderrText = stderrCollector.getText()
    // Verify spaces are trimmed
    expect(stderrText).toContain('groq,clarifai/fp4,google-vertex')
  })
})
