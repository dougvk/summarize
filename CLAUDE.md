# CLAUDE.md - Project Context for AI Assistants

## What is this?

This is a fork of [@steipete/summarize](https://github.com/steipete/summarize) - a Node.js CLI tool for summarizing any URL or file. The fork adds OpenRouter support and enhanced YouTube transcription.

## Why does this fork exist?

This fork is being developed to integrate with [chatpod-backend](~/Documents/GitHub/chatpod-backend) as a **sidecar service** for content extraction. The goal is to use summarize's extraction capabilities (YouTube transcripts, web articles, PDFs) to feed chatpod-backend's RAG pipeline.

### Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Compose                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    HTTP     ┌─────────────────────────┐   │
│  │  chatpod    │◄───────────►│  summarize-sidecar      │   │
│  │  backend    │   :3100     │  (Node.js + yt-dlp)     │   │
│  └─────────────┘             └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

The sidecar will run in **extract-only mode** (`--extract-only`). Chatpod-backend handles LLM summarization with its own OpenRouter service (which has `json_schema`, `reasoning`/thinking support).

## Key Features Added to This Fork

### 1. OpenRouter Support (`--model auto`)

Context-aware model selection via OpenRouter based on input token count:
- **< 95K tokens**: Uses `openai/gpt-oss-20b` via `groq,clarifai/fp4,google-vertex`
- **95K-950K tokens**: Uses `google/gemini-2.5-flash-lite-preview-09-2025` via `google-ai-studio,google-vertex`
- **> 950K tokens**: Error (no truncation)

Configurable via environment variables:
- `OPENROUTER_API_KEY` - Required for `--model auto`
- `OPENROUTER_MODEL_SMALL`, `OPENROUTER_MODEL_LARGE` - Custom models
- `OPENROUTER_THRESHOLD_SMALL`, `OPENROUTER_THRESHOLD_MAX` - Token thresholds
- `OPENROUTER_PROVIDERS_SMALL`, `OPENROUTER_PROVIDERS_LARGE` - Provider ordering

### 2. yt-dlp + FAL AI Whisper Transcription

When YouTube captions aren't available:
1. yt-dlp downloads audio
2. FAL AI Whisper transcribes it
3. Falls back to OpenAI Whisper if FAL unavailable

Environment variables:
- `YT_DLP_PATH` - Path to yt-dlp binary
- `FAL_KEY` - FAL AI API key (preferred)
- `OPENAI_API_KEY` - OpenAI Whisper fallback

## How to Run

### Local Development

```bash
pnpm install
pnpm build
pnpm check  # lint + tests with coverage
```

### Docker (with yt-dlp)

```bash
docker build -f Dockerfile.test -t summarize-test .

docker run --rm \
  -e FAL_KEY="..." \
  -e OPENROUTER_API_KEY="..." \
  -e YT_DLP_PATH="/usr/local/bin/yt-dlp" \
  summarize-test \
  "https://youtu.be/VIDEO_ID" --model auto --youtube yt-dlp
```

### Example Commands

```bash
# YouTube with auto model selection
summarize "https://youtu.be/cPE0f0uV3LM" --model auto --youtube yt-dlp

# Web page extraction only (no LLM)
summarize "https://example.com/article" --extract-only

# Explicit model
summarize "https://example.com" --model google/gemini-2.5-flash-lite-preview-09-2025
```

## Current State

### PR #5: `--model auto` Feature
- Branch: `model-auto`
- Status: Ready for review
- URL: https://github.com/steipete/summarize/pull/5
- Added tests in `tests/cli.model-auto.test.ts` to meet 75% branch coverage threshold

### Recent Fixes
- **Exit hang fix**: Added `process.exit()` in `src/cli.ts` `.finally()` to avoid dangling handles from stream error listeners
- **Dockerfile.test**: Changed entrypoint from `pnpm summarize` (tsx) to `node dist/cli.cjs` for clean exits

### Files Modified from Upstream
- `src/run.ts` - Added `parseOpenRouterAutoConfig()`, `resolveOpenRouterAutoModel()`, `--model auto` handling
- `src/cli.ts` - Added `.finally()` exit fix
- `Dockerfile.test` - Fixed entrypoint
- `tests/cli.model-auto.test.ts` - New test file for auto model selection
- `README.md`, `CHANGELOG.md` - Documentation

## API Keys Location

For local testing, keys are in:
- `FAL_KEY`: `~/Documents/GitHub/chatpod-backend/.env`
- `OPENROUTER_API_KEY`: `~/Documents/GitHub/chatpod-backend/.env` (as `OPENROUTER_KEY`)

## How the LLM Call Works

When summarizing via OpenRouter, the call is simple:

```typescript
streamTextWithModelId({
  modelId: 'openai/gpt-oss-20b',  // or auto-selected
  apiKeys: { openrouterApiKey: '...' },
  openrouter: { providers: ['groq', 'clarifai/fp4', 'google-vertex'] },
  prompt: '...',  // extracted content + summarize instructions
  temperature: 0,
  maxOutputTokens: ...,
  timeoutMs: ...,
})
```

**What's NOT passed** (unlike chatpod-backend):
- No `json_schema` / `response_format` - returns plain text
- No `reasoning` / thinking config
- No `system` prompt separation

This is intentional - summarize is a simple extraction/summarization tool. Chatpod-backend handles structured output and thinking modes in its own OpenRouter service.

## Next Steps (Integration Plan)

See plan file: `~/.claude/plans/unified-purring-yeti.md`

1. **Phase 1**: Create HTTP wrapper (`src/server.ts`) with Fastify
2. **Phase 2**: Create `Dockerfile.sidecar` for production
3. **Phase 3**: Add `SummarizeService` to chatpod-backend
4. **Phase 4**: Add `extraction_jobs` table and worker
5. **Phase 5**: Wire up in docker-compose

## Test Commands

```bash
# Run all tests with coverage
pnpm check

# Run specific test file
pnpm test -- tests/cli.model-auto.test.ts

# Run with verbose output
pnpm test -- --reporter=verbose
```

## Upstream Sync

This fork tracks `steipete/summarize`. To sync:

```bash
git fetch upstream
git merge upstream/main
# Resolve conflicts, keeping our additions
```

Current base: v0.3.0 (2025-12-20)
