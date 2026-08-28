import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { synthesizeSpeech } from './tts'
import { AiError } from './types'

function audioResponse(body: Uint8Array, ok = true, status = 200): Response {
  return {
    ok,
    status,
    arrayBuffer: async () =>
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
    json: async () => ({ error: { message: 'boom' } }),
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('synthesizeSpeech', () => {
  it('calls ElevenLabs with the voice id and xi-api-key header, returns audio bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(bytes))
    vi.stubGlobal('fetch', fetchMock)

    const res = await synthesizeSpeech({
      provider: 'elevenlabs',
      apiKey: 'sk_abc',
      voice: 'Rachel-xyz',
      text: 'Hello there',
    })

    expect(res.mimeType).toBe('audio/mpeg')
    expect([...res.buffer]).toEqual([1, 2, 3])
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.elevenlabs.io/v1/text-to-speech/Rachel-xyz')
    expect(opts.headers['xi-api-key']).toBe('sk_abc')
    const body = JSON.parse(opts.body)
    expect(body.text).toBe('Hello there')
  })

  it('calls the OpenAI speech endpoint with Bearer auth for the openai provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(new Uint8Array([9])))
    vi.stubGlobal('fetch', fetchMock)

    await synthesizeSpeech({
      provider: 'openai',
      apiKey: 'sk-x',
      voice: 'alloy',
      text: 'Hi',
    })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com/v1/audio/speech')
    expect(opts.headers.Authorization).toBe('Bearer sk-x')
    const body = JSON.parse(opts.body)
    expect(body.voice).toBe('alloy')
    expect(body.model).toBeTruthy()
  })

  it('throws an empty-response AiError when the provider returns no audio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(audioResponse(new Uint8Array(0))),
    )
    await expect(
      synthesizeSpeech({
        provider: 'elevenlabs',
        apiKey: 'sk_abc',
        voice: 'v',
        text: 'x',
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})