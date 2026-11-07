import { describe, expect, it } from 'vitest';
import { detectWake, isResume, isWakeToken, looksLikeControl, soundsLikeWake } from '../wake';

describe('detectWake', () => {
  it('finds the wake word at the start and strips punctuation', () => {
    expect(detectWake('Scribe, add to decisions: use Postgres 16.', 'Scribe')).toEqual({
      addressed: true,
      command: 'add to decisions: use Postgres 16.',
    });
  });

  it('allows "hey" or "ok" before it', () => {
    expect(detectWake('Hey Scribe add an action item', 'Scribe').command).toBe('add an action item');
    expect(detectWake('okay, scribe. what is still open?', 'Scribe').command).toBe('what is still open?');
  });

  it('tolerates one wrong letter from the captions', () => {
    expect(isWakeToken('Scrib', 'Scribe')).toBe(true);
    expect(isWakeToken('Scribe.', 'Scribe')).toBe(true);
    expect(isWakeToken('Scribes', 'Scribe')).toBe(true);
  });

  it('does not fire on ordinary speech or reported speech', () => {
    expect(detectWake('Sarah said we should delete the timeline', 'Scribe').addressed).toBe(false);
    expect(detectWake('Describe the timeline for me', 'Scribe').addressed).toBe(false);
    expect(detectWake('I think the scribe should add that', 'Scribe').addressed).toBe(false);
  });

  it('ignores the wake word on its own with no request', () => {
    expect(detectWake('Scribe.', 'Scribe').addressed).toBe(false);
  });

  it('treats a word that only sounds like the wake word as a maybe, for the AI to check', () => {
    expect(detectWake('Subscribe! Can you take a screenshot?', 'Scribe')).toEqual({ addressed: false, maybe: true, command: 'Can you take a screenshot?' });
    expect(detectWake('Subscribe, add Postgres to decisions', 'Scribe')).toMatchObject({ addressed: false, maybe: true });
    expect(detectWake('Describe the plan for Friday', 'Scribe')).toMatchObject({ addressed: false, maybe: true, command: 'the plan for Friday' });
    expect(detectWake('Scrub, add Postgres to decisions', 'Scribe').maybe).toBe(true);
    expect(detectWake('Hey script, add Postgres to decisions', 'Scribe').maybe).toBe(true);
    expect(detectWake('Subscribe!', 'Scribe')).toEqual({ addressed: false, command: '', wakeOnly: true, maybe: true });
  });

  it('is sure only of the wake word itself, and never a maybe for words that sound different', () => {
    expect(detectWake('Scribe, add Postgres to decisions', 'Scribe').maybe).toBeUndefined();
    expect(detectWake('Strive for Friday', 'Scribe')).toEqual({ addressed: false, command: '' });
    expect(detectWake('Scream test is done', 'Scribe')).toEqual({ addressed: false, command: '' });
    expect(detectWake('I subscribe to that', 'Scribe')).toEqual({ addressed: false, command: '' });
    expect(soundsLikeWake('Subscribe', 'Scribe')).toBe(true);
    expect(soundsLikeWake('Describe', 'Scribe')).toBe(true);
    expect(soundsLikeWake('Tribe', 'Scribe')).toBe(false);
  });

  it('works with a custom wake word', () => {
    expect(detectWake('Notes, add Wei owns on-call', 'Notes').command).toBe('add Wei owns on-call');
  });
});

describe('control matchers', () => {
  it('spots requests to change Scribe itself', () => {
    for (const c of [
      'switch to smart mode',
      'go to commands mode',
      'smart mode',
      'pause',
      'stop listening',
      'resume',
      'start recording',
      'pause the recording',
      'stop the video recording',
      'work on the tracker',
      'ask before writing',
      'make direct edits',
    ]) {
      expect(looksLikeControl(c), c).toBe(true);
    }
  });

  it('leaves ordinary requests alone, even ones that say "record"', () => {
    for (const c of ['record that we decided on Postgres', 'add Postgres to decisions', 'what did we decide about the start date']) {
      expect(looksLikeControl(c), c).toBe(false);
    }
  });

  it('recognises resume, and only resume', () => {
    expect(isResume('resume')).toBe(true);
    expect(isResume('please start listening')).toBe(true);
    expect(isResume('continue')).toBe(true);
    expect(isResume('add resume link to notes')).toBe(false);
    expect(isResume('pause')).toBe(false);
  });
});
