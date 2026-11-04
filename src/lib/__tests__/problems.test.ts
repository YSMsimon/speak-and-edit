import { describe, expect, it } from 'vitest';
import { describeProblem, normalizeError } from '../problems';
import { ollamaFetch } from '../ai/providers';

describe('describeProblem', () => {
  it('turns the ChatGPT sign-in failure Simon hit into a plain message with the raw code under Details', () => {
    const p = describeProblem(new Error('ChatGPT sign-in failed (invalid_grant: Invalid authorization code).'));
    expect(p).toEqual({
      severity: 'error',
      title: 'Couldn’t connect ChatGPT',
      body: 'Using your plan needs ChatGPT Plus or Pro. If you have one, try again.',
      fixes: ['retry', 'use-ollama'],
      detail: 'ChatGPT sign-in failed (invalid_grant: Invalid authorization code).',
    });
  });

  it('points a usage limit at Manage usage, without a Details block', () => {
    const p = describeProblem('Your ChatGPT plan’s limit for Scribe is used up for now. Manage usage: https://chatgpt.com/settings/usage');
    expect(p).toMatchObject({ severity: 'warning', title: 'ChatGPT plan limit reached', fixes: ['manage-usage', 'use-ollama'] });
    expect(p.detail).toBeUndefined();
  });

  it('knows Ollama’s two common failures', () => {
    expect(describeProblem('Ollama blocked Scribe (403). Set OLLAMA_ORIGINS and restart Ollama.').title).toBe('Ollama is blocking Scribe');
    expect(describeProblem('Can’t reach Ollama at http://localhost:11434.').title).toBe('Ollama isn’t running');
  });

  it('maps Google’s raw API errors', () => {
    expect(describeProblem('The caller does not have permission').title).toBe('You can’t edit this file');
    expect(describeProblem('Requested entity was not found.').title).toBe('File not found');
    expect(describeProblem('Failed to fetch').title).toBe('No connection');
  });

  it('keeps Scribe’s own wording when a request needs more detail', () => {
    expect(describeProblem('“Fix login” is in 2 rows (A, B). Say which one.')).toEqual({ severity: 'info', title: 'Scribe needs more detail', body: '“Fix login” is in 2 rows (A, B). Say which one.', fixes: [] });
  });

  it('falls back to the message itself', () => {
    expect(describeProblem(new Error('Something odd.'))).toEqual({ severity: 'error', title: 'Couldn’t do that', body: 'Something odd.', fixes: [] });
  });
});

describe('normalizeError', () => {
  it('names Ollama when the AI SDK only says it could not connect, even inside a retry error', () => {
    const inner = Object.assign(new Error('Cannot connect to API: Failed to fetch'), { url: 'http://localhost:11434/v1/chat/completions' });
    const retry = Object.assign(new Error('Failed after 2 attempts. Last error: Cannot connect to API: Failed to fetch'), { lastError: inner });
    expect(normalizeError(retry)).toBe('Can’t reach Ollama at http://localhost:11434.');
    expect(describeProblem(normalizeError(retry)).title).toBe('Ollama isn’t running');
  });

  it('turns Ollama’s 403 into the OLLAMA_ORIGINS problem', () => {
    const e = Object.assign(new Error('Forbidden'), { url: 'http://localhost:11434/v1/chat/completions', statusCode: 403 });
    expect(describeProblem(normalizeError(e)).title).toBe('Ollama is blocking Scribe');
  });

  it('leaves everything else alone', () => {
    expect(normalizeError(new Error('The doc kept changing. Try again.'))).toBe('The doc kept changing. Try again.');
  });
});

describe('ollamaFetch', () => {
  it('says Ollama isn’t running when the connection is refused, instead of a bare Failed to fetch', async () => {
    const f = ollamaFetch('http://localhost:11434/', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(f('http://localhost:11434/v1/chat/completions')).rejects.toThrow('Can’t reach Ollama at http://localhost:11434.');
    expect(describeProblem('Can’t reach Ollama at http://localhost:11434.').title).toBe('Ollama isn’t running');
  });

  it('turns the Overleaf target’s errors into cards with a fix', () => {
    expect(describeProblem('Chrome needs your OK to use Overleaf. Press Add in Outputs › Overleaf and allow it.')).toMatchObject({ title: 'Chrome hasn’t allowed Overleaf yet', fixes: ['outputs-tab'] });
    expect(describeProblem('Sign in to Overleaf in this Chrome, then try again.')).toMatchObject({ severity: 'error', title: 'Overleaf isn’t signed in' });
    const tex = describeProblem('“refs.bib” isn’t a .tex file. Open the .tex file you want Scribe to edit in the Overleaf tab.');
    expect(tex).toMatchObject({ severity: 'info', title: 'Open a .tex file in Overleaf' });
    expect(tex.body).toMatch(/refs\.bib/);
    expect(describeProblem('The Overleaf file kept changing while Scribe wrote. Try again.').title).toBe('The file kept changing');
    expect(describeProblem('The Overleaf tab was closed. Open the project again.').fixes).toEqual(['retry']);
  });

  it('names OLLAMA_ORIGINS on a 403', async () => {
    const f = ollamaFetch('http://localhost:11434', async () => new Response('', { status: 403 }));
    await expect(f('http://localhost:11434/v1/chat/completions')).rejects.toThrow('OLLAMA_ORIGINS');
  });
});
