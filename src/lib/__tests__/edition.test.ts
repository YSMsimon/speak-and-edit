import { describe, expect, it } from 'vitest';
import { FULL } from '../edition';
import { describeProblem } from '../problems';
import { DEFAULT_SETTINGS, defaultsFor, fileKindsFor, mergeSettings, providersFor } from '../settings';

// The public edition (Chrome Web Store, GitHub releases) is Google-only, with ChatGPT or the built-in
// model. The full edition adds Obsidian, Overleaf, Ollama and API keys. Tests run as the full edition.
describe('editions', () => {
  it('runs the tests as the full edition', () => {
    expect(FULL).toBe(true);
    expect(DEFAULT_SETTINGS.provider).toBe('ollama');
  });

  it('offers only ChatGPT and the built-in model in the public edition', () => {
    expect(providersFor(false)).toEqual({ basic: ['chrome', 'chatgpt'], advanced: [] });
    expect(providersFor(true).basic).toContain('ollama');
    expect(providersFor(true).advanced).toEqual(['openrouter', 'anthropic', 'openai', 'gemini', 'groq']);
  });

  it('edits only Google files in the public edition', () => {
    expect(fileKindsFor(false)).toEqual(['doc', 'sheet', 'slides']);
    expect(fileKindsFor(true)).toEqual(['doc', 'sheet', 'slides', 'note', 'tex']);
  });

  it('starts the public edition on the built-in model, with no Ollama screen model', () => {
    expect(defaultsFor(false)).toMatchObject({ provider: 'chrome', visionModels: {} });
    expect(defaultsFor(true)).toMatchObject({ provider: 'ollama', visionModels: { ollama: 'gemma4:31b-cloud' } });
  });

  it('drops what the public edition leaves out from saved settings', () => {
    const saved = {
      provider: 'ollama',
      keys: { anthropic: 'k', openrouter: 'k2' },
      visionModels: { ollama: 'gemma4:31b-cloud' },
      files: [
        { id: 'doc1', kind: 'doc', title: 'Roadmap' },
        { id: 'note:Meetings/Today.md', kind: 'note', title: 'Today' },
        { id: 'overleaf:abc', kind: 'tex', title: 'Paper' },
      ],
      focusFileId: 'overleaf:abc',
    };
    const s = mergeSettings(saved, false);
    expect(s.provider).toBe('chrome');
    expect(s.keys).toEqual({});
    expect(s.visionModels).toEqual({});
    expect(s.files.map((f) => f.kind)).toEqual(['doc']);
    expect(s.focusFileId).toBeNull();
    // The full edition keeps all of it.
    const f = mergeSettings(saved, true);
    expect(f.provider).toBe('ollama');
    expect(f.files).toHaveLength(3);
    expect(f.focusFileId).toBe('overleaf:abc');
  });

  it('keeps a signed-in ChatGPT in the public edition', () => {
    expect(mergeSettings({ provider: 'chatgpt', chatgptAccount: 'a@example.com' }, false)).toMatchObject({ provider: 'chatgpt', chatgptAccount: 'a@example.com' });
  });

  it('offers the built-in model instead of Ollama on problem cards', () => {
    expect(describeProblem('Not signed in.', false).fixes).toEqual(['chatgpt-signin', 'use-builtin']);
    expect(describeProblem('Not signed in.', true).fixes).toEqual(['chatgpt-signin', 'use-ollama']);
    const p = describeProblem('ChatGPT’s plan can’t do this request (unsupported_capability).', false);
    expect(p).toMatchObject({ body: 'Try it with the built-in model instead.', fixes: ['use-builtin'] });
  });

  it('offers ChatGPT when the built-in model is what failed', () => {
    expect(describeProblem('This browser has no built-in model.', false)).toMatchObject({ body: 'Sign in with ChatGPT instead.', fixes: ['chatgpt-signin'] });
    expect(describeProblem('This computer can’t run the built-in model.', false).fixes).toEqual(['chatgpt-signin']);
  });

  it('never offers Get Ollama in the public edition', () => {
    const p = describeProblem('Can’t reach Ollama at http://localhost:11434.', false);
    expect(p.fixes).toEqual(['retry']);
  });
});
