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
  it('keeps keys for known services (v0.6), drops unknown ones, and moves the old Auto to Ollama', () => {
    const s = mergeSettings({
      provider: 'openrouter',
      keys: { openai: 'sk-x', mystery: 'zzz' },
      models: { ollama: 'gemma4:31b-cloud', openai: 'gpt-5-mini', mystery: 'm' },
      visionModels: { anthropic: 'claude', mystery: 'm' },
    });
    expect(s.provider).toBe('openrouter');
    expect(s.keys).toEqual({ openai: 'sk-x' });
    expect(mergeSettings({ provider: 'auto' }).provider).toBe('ollama');
    expect(mergeSettings({ provider: 'mystery' }).provider).toBe('ollama');
    expect(s.models).toMatchObject({ chrome: 'text', ollama: 'gemma4:31b-cloud', chatgpt: '', openai: 'gpt-5-mini', anthropic: 'claude-haiku-5-5' });
    expect(s.models).not.toHaveProperty('mystery');
    expect(s.visionModels).toEqual({ ollama: 'gemma4:31b-cloud', anthropic: 'claude' });
    expect(s.chatgptAccount).toBeNull();
  });

  it('keeps ChatGPT, Ollama and the built-in model', () => {
    expect(mergeSettings({ provider: 'chatgpt', chatgptAccount: 'simon@example.com' })).toMatchObject({ provider: 'chatgpt', chatgptAccount: 'simon@example.com' });
    expect(mergeSettings({ provider: 'ollama' }).provider).toBe('ollama');
  });
});
