import { afterEach, describe, expect, it, vi } from 'vitest';
import { canListen, listenOnce } from './voice';

afterEach(() => vi.unstubAllGlobals());

describe('voice ask', () => {
  it('is unsupported without the Web Speech API (mic hidden)', () => {
    vi.stubGlobal('window', {});
    expect(canListen()).toBe(false);
    expect(
      listenOnce(
        'hi',
        () => undefined,
        () => undefined,
      ),
    ).toBeNull();
  });
  it('listens in the app language and hands over the transcript', () => {
    let lang = '';
    class Fake {
      lang = '';
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        lang = this.lang;
        this.onresult?.({ results: [[{ transcript: ' सबसे ज्यादा बकाया किसका है ' }]] });
        this.onend?.();
      }
      stop() {}
    }
    vi.stubGlobal('window', { webkitSpeechRecognition: Fake });
    const got: string[] = [];
    let ended = false;
    expect(canListen()).toBe(true);
    listenOnce(
      'hi',
      (t) => got.push(t),
      () => (ended = true),
    );
    expect(lang).toBe('hi-IN');
    expect(got).toEqual(['सबसे ज्यादा बकाया किसका है']);
    expect(ended).toBe(true);
  });
});
