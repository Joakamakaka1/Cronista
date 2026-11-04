import { describe, expect, it } from 'vitest';

import { compareBench, summarizeBench } from './bench-summary.ts';

const promptfooResult = (scenario: string, success: boolean, output = '{"text":"x"}') => ({
  vars: { scenario },
  success,
  cost: 0.001,
  response: { output, tokenUsage: { prompt: 100, completion: 20 } },
});

describe('summarizeBench', () => {
  it('keeps one row per case, sorted, with a short sample', () => {
    const summary = summarizeBench({
      results: {
        results: [promptfooResult('b', false, 'x'.repeat(1000)), promptfooResult('a', true)],
      },
    });

    expect(Object.keys(summary.cases)).toEqual(['a', 'b']);
    expect(summary.cases.a).toEqual({
      pass: true,
      error: null,
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      sample: '{"text":"x"}',
    });
    expect(summary.cases.b?.sample).toHaveLength(400);
  });

  it('keeps a failure with no response', () => {
    const summary = summarizeBench({
      results: { results: [{ vars: { scenario: 'a' }, success: false, error: 'boom' }] },
    });

    expect(summary.cases.a).toMatchObject({ pass: false, error: 'boom', inputTokens: 0 });
  });
});

describe('compareBench', () => {
  const row = (pass: boolean) => ({
    pass,
    error: null,
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.001,
    sample: '',
  });

  it('calls a case that passed and now fails a regression', () => {
    const result = compareBench({ cases: { a: row(true) } }, { cases: { a: row(false) } });

    expect(result.regressed).toBe(true);
    expect(result.lines[0]).toContain('pass -> FAIL');
  });

  it('does not call a case that already failed a regression', () => {
    const result = compareBench({ cases: { a: row(false) } }, { cases: { a: row(false) } });

    expect(result.regressed).toBe(false);
  });

  it('marks a case the baseline does not have, and totals the cost', () => {
    const result = compareBench({ cases: {} }, { cases: { a: row(true) } });

    expect(result.regressed).toBe(false);
    expect(result.lines[0]).toContain('new pass');
    expect(result.lines.at(-1)).toBe('total cost: 0.0000 $ -> 0.0010 $');
  });
});
