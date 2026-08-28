import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transcribeAudio } from './transcribe'
import { AiError } from './types'

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

const AUDIO = Buffer.from('fake-ogg-bytes')

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('transcribeAudio', () => {
  it('calls the Groq OpenAI-compatible endpoint and returns the text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: 'Hello there' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await transcribeAudio({
      provider: 'groq',
      apiKey: 'gsk-x',
      buffer: AUDIO,
      mimeType: 'audio/ogg',
    })

    expect(res).toEqual({ text: 'Hello there' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.groq.com/openai/v1/audio/transcriptions')
    expect(opts.headers.Authorization).toBe('Bearer gsk-x')
    expect(opts.body).toBeInstanceOf(FormData)
  })

  it('calls the OpenAI endpoint when the provider is openai', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    await transcribeAudio({
      provider: 'openai',
      apiKey: 'sk-x',
      buffer: AUDIO,
      mimeType: 'audio/mpeg',
    })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com/v1/audio/transcriptions')
    expect(opts.headers.Authorization).toBe('Bearer sk-x')
  })

  it('throws an empty-response AiError on an empty transcription', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ text: '  ' })))
    await expect(
      transcribeAudio({
        provider: 'groq',
        apiKey: 'gsk-x',
        buffer: AUDIO,
        mimeType: 'audio/ogg',
      }),
    ).rejects.toBeInstanceOf(AiError)
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errResponse(401, { error: { message: 'Invalid key' } })),
    )
    await expect(
      transcribeAudio({
        provider: 'groq',
        apiKey: 'bad',
        buffer: AUDIO,
        mimeType: 'audio/ogg',
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })
})