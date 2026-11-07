import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProvider, cloudName, ensureAccess, isOllamaCloud, listOllamaCloudModels, modelFor, PROVIDER_ORIGINS, sendsOffDevice } from '../ai/providers';
import { describeProblem } from '../problems';
import { ADVANCED_PROVIDERS, DEFAULT_SETTINGS, type Settings } from '../settings';

const perms = { contains: vi.fn(async () => false), request: vi.fn(async () => true) };
(globalThis as any).chrome = { permissions: perms, storage: { local: { get: async () => ({}) } } };
afterEach(() => vi.clearAllMocks());

const withKeys: Settings = { ...DEFAULT_SETTINGS, keys: { anthropic: 'sk-ant-test', openrouter: 'sk-or-test' } };

describe('Use your own API key', () => {
  it('every advanced service has its own optional permission', () => {
    for (const id of ADVANCED_PROVIDERS) expect(PROVIDER_ORIGINS[id]?.length).toBeGreaterThan(0);
    expect(PROVIDER_ORIGINS.ollama).toBeUndefined();
  });

  it('asks Chrome for just that one service, straight away (from the click)', async () => {
    expect(await ensureAccess('anthropic')).toBe(true);
    expect(perms.request).toHaveBeenCalledWith({ origins: ['https://api.anthropic.com/*'] });
    expect(perms.contains).not.toHaveBeenCalled();
  });

  it('only checks, never asks, when the panel refreshes its status', async () => {
    const st = await checkProvider('anthropic', withKeys);
    expect(perms.request).not.toHaveBeenCalled();
    expect(st).toEqual({ ok: false, detail: 'Scribe needs permission to reach Claude (Anthropic).' });
    perms.contains.mockResolvedValueOnce(true);
    expect((await checkProvider('anthropic', withKeys)).ok).toBe(true);
  });

  it('says what is missing before a key is added', async () => {
    expect(await checkProvider('groq', DEFAULT_SETTINGS)).toEqual({ ok: false, detail: 'No key added yet.' });
    expect(await checkProvider('openrouter', DEFAULT_SETTINGS)).toEqual({ ok: false, detail: 'Not connected yet.' });
  });

  it('builds a model for each service, strict JSON where the API enforces it', () => {
    for (const id of ADVANCED_PROVIDERS) expect(modelFor(id, withKeys).model).toBeTruthy();
    expect(modelFor('anthropic', withKeys).mode).toBe('strict');
    expect(modelFor('openrouter', withKeys).mode).toBe('prompt');
    expect(sendsOffDevice('groq', withKeys)).toBe(true);
    expect(sendsOffDevice('chrome', withKeys)).toBe(false);
  });

  it('turns the services’ key and credit errors into plain cards', () => {
    expect(describeProblem('Incorrect API key provided: sk-…').title).toBe('That API key didn’t work');
    expect(describeProblem('invalid x-api-key').title).toBe('That API key didn’t work');
    expect(describeProblem('Your credit balance is too low to access the Anthropic API.').title).toBe('No credit left on that account');
    expect(describeProblem('Scribe needs permission to reach Groq.').title).toBe('Chrome hasn’t allowed this service yet');
  });
});

describe('Ollama cloud models', () => {
  it('names them the way the Ollama app does', () => {
    expect(cloudName('gpt-oss:120b')).toBe('gpt-oss:120b-cloud');
    expect(cloudName('glm-5.3')).toBe('glm-5.3:cloud');
    expect(isOllamaCloud('glm-5.3:cloud')).toBe(true);
    expect(isOllamaCloud('gpt-oss:120b-cloud')).toBe(true);
    expect(isOllamaCloud('llama3:8b')).toBe(false);
  });

  it('lists every chat model from ollama.com, marking the ones that can read pictures', async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({ models: [
      { name: 'gpt-oss:120b', capabilities: ['completion', 'tools'] },
      { name: 'kimi-k3', capabilities: ['completion', 'vision'] },
      { name: 'clef:27b', capabilities: ['decision', 'vision'] },
    ] })));
    const models = await listOllamaCloudModels(fake as unknown as typeof fetch);
    expect(models).toEqual([
      { name: 'gpt-oss:120b-cloud', vision: false },
      { name: 'kimi-k3:cloud', vision: true },
    ]);
  });
});
