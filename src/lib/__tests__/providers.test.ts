import { describe, expect, it, vi } from 'vitest';
import { checkProvider, lowestReasoning, modelFor, sendsOffDevice, visionModelName } from '../ai/providers';
import { DEFAULT_SETTINGS, PROVIDER_IDS, type Settings } from '../settings';

(globalThis as any).chrome = { storage: { local: { get: vi.fn(async () => ({})) } } };

const chatgpt: Settings = { ...DEFAULT_SETTINGS, provider: 'chatgpt', models: { ...DEFAULT_SETTINGS.models, chatgpt: 'gpt-5.4-mini' } };

describe('providers', () => {
  it('offers only ChatGPT and the built-in model, starting on the built-in one', () => {
    expect(PROVIDER_IDS).toEqual(['chrome', 'chatgpt']);
    expect(DEFAULT_SETTINGS.provider).toBe('chrome');
  });

  it('builds both with a strict JSON schema', () => {
    expect(modelFor('chatgpt', chatgpt).mode).toBe('strict');
    expect(modelFor('chrome', DEFAULT_SETTINGS).mode).toBe('strict');
  });

  it('knows which one sends lines off this computer', () => {
    expect(sendsOffDevice('chatgpt', chatgpt)).toBe(true);
    expect(sendsOffDevice('chrome', DEFAULT_SETTINGS)).toBe(false);
    expect(sendsOffDevice(null, DEFAULT_SETTINGS)).toBe(false);
  });

  it('reads the shared screen with the normal model', () => {
    expect(visionModelName('chatgpt', chatgpt)).toBe('gpt-5.4-mini');
  });

  it('says ChatGPT isn’t signed in before anything is sent', async () => {
    expect(await checkProvider('chatgpt', chatgpt)).toEqual({ ok: false, detail: 'Not signed in.' });
  });
});

describe('lowest reasoning per model', () => {
  it('gives each model the least thinking it accepts', () => {
    expect(lowestReasoning('chatgpt', 'gpt-5-mini')).toBe('minimal');
    expect(lowestReasoning('chatgpt', 'gpt-5.4-mini')).toBe('none');
    expect(lowestReasoning('chatgpt', 'gpt-5.3-codex')).toBe('low');
    expect(lowestReasoning('chrome', 'text')).toBeUndefined();
  });

  it('is on the model Scribe builds', () => {
    expect(modelFor('chatgpt', chatgpt).reasoning).toBe('none');
    expect(modelFor('chrome', DEFAULT_SETTINGS).reasoning).toBeUndefined();
  });
});
