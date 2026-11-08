import { describe, expect, it } from 'vitest';
import { mergeSettings } from '../settings';

describe('mergeSettings', () => {
  it('drops the Slack output and the custom credit line saved by older versions', () => {
    const s = mergeSettings({
      creditTemplate: '{name} asked at {time}',
      slackWebhook: 'https://hooks.slack.com/services/T/B/x',
      outputs: { docComments: false, slack: true },
    });
    expect(s).not.toHaveProperty('creditTemplate');
    expect(s).not.toHaveProperty('slackWebhook');
    expect(s.outputs).toEqual({ docComments: false });
  });

  it('drops the removed “Share with Claude” switch from old saves', () => {
    expect(mergeSettings({ shareWithClaude: true })).not.toHaveProperty('shareWithClaude');
  });

  it('keeps credit on by default', () => {
    expect(mergeSettings(undefined).outputs).toEqual({ docComments: true });
  });
});

describe('mergeSettings: providers', () => {
  it('drops Ollama, API keys and per-provider screen models saved by older versions', () => {
    const s = mergeSettings({
      provider: 'openrouter',
      keys: { openai: 'sk-x' },
      ollamaUrl: 'http://localhost:11434',
      models: { ollama: 'gemma4:31b-cloud', openai: 'gpt-5-mini', chatgpt: 'gpt-5.4-mini' },
      visionModels: { ollama: 'gemma4:31b-cloud' },
    });
    expect(s.provider).toBe('chrome');
    expect(s).not.toHaveProperty('keys');
    expect(s).not.toHaveProperty('ollamaUrl');
    expect(s).not.toHaveProperty('visionModels');
    expect(s.models).toEqual({ chrome: 'text', chatgpt: 'gpt-5.4-mini' });
    expect(s.chatgptAccount).toBeNull();
    expect(mergeSettings({ provider: 'auto' }).provider).toBe('chrome');
    expect(mergeSettings({ provider: 'ollama' }).provider).toBe('chrome');
  });

  it('keeps ChatGPT and the built-in model', () => {
    expect(mergeSettings({ provider: 'chatgpt', chatgptAccount: 'simon@example.com' })).toMatchObject({ provider: 'chatgpt', chatgptAccount: 'simon@example.com' });
    expect(mergeSettings({ provider: 'chrome' }).provider).toBe('chrome');
  });

  it('drops Obsidian notes and Overleaf projects saved by older versions', () => {
    const s = mergeSettings({
      files: [
        { id: 'doc1', kind: 'doc', title: 'Roadmap' },
        { id: 'note:Meetings/Today.md', kind: 'note', title: 'Today' },
        { id: 'overleaf:abc', kind: 'tex', title: 'Paper' },
      ],
      focusFileId: 'overleaf:abc',
    });
    expect(s.files.map((f) => f.kind)).toEqual(['doc']);
    expect(s.focusFileId).toBeNull();
  });
});
