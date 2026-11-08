import { describe, expect, it } from 'vitest';
import { describeProblem, normalizeError } from '../problems';

describe('describeProblem', () => {
  it('turns the ChatGPT sign-in failure Simon hit into a plain message with the raw code under Details', () => {
    const p = describeProblem(new Error('ChatGPT sign-in failed (invalid_grant: Invalid authorization code).'));
    expect(p).toEqual({
      severity: 'error',
      title: 'Couldn’t connect ChatGPT',
      body: 'Using your plan needs ChatGPT Plus or Pro. If you have one, try again.',
      fixes: ['retry', 'use-builtin'],
      detail: 'ChatGPT sign-in failed (invalid_grant: Invalid authorization code).',
    });
  });

  it('points a usage limit at Manage usage, without a Details block', () => {
    const p = describeProblem('Your ChatGPT plan’s limit for Scribe is used up for now. Manage usage: https://chatgpt.com/settings/usage');
    expect(p).toMatchObject({ severity: 'warning', title: 'ChatGPT plan limit reached', fixes: ['manage-usage', 'use-builtin'] });
    expect(p.detail).toBeUndefined();
  });

  it('offers ChatGPT when the built-in model can’t run', () => {
    expect(describeProblem('This browser has no built-in model.')).toMatchObject({ body: 'Sign in with ChatGPT instead.', fixes: ['chatgpt-signin'] });
    expect(describeProblem('Chrome says this device can’t run the built-in model.').fixes).toEqual(['chatgpt-signin']);
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
  it('reads the last error out of the AI SDK’s retry error', () => {
    const inner = new Error('Cannot connect to API: Failed to fetch');
    const retry = Object.assign(new Error('Failed after 2 attempts. Last error: Cannot connect to API: Failed to fetch'), { lastError: inner });
    expect(normalizeError(retry)).toBe('Cannot connect to API: Failed to fetch');
    expect(describeProblem(normalizeError(retry)).title).toBe('No connection');
  });

  it('leaves everything else alone', () => {
    expect(normalizeError(new Error('The doc kept changing. Try again.'))).toBe('The doc kept changing. Try again.');
  });
});
