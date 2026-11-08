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
      toolCalls: null,
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

  it('calls a case that went missing a regression, so dropping one cannot hide it', () => {
    const result = compareBench(
      { cases: { a: row(true), b: row(true) } },
      { cases: { a: row(true) } },
    );

    expect(result.regressed).toBe(true);
    expect(result.lines[0]).toBe('b: in the baseline, but this run did not have it');
  });

  it('marks a case the baseline does not have, and totals the cost', () => {
    const result = compareBench({ cases: {} }, { cases: { a: row(true) } });

    expect(result.regressed).toBe(false);
    expect(result.lines[0]).toContain('new pass');
    expect(result.lines.at(-1)).toBe('total cost: 0.0000 $ -> 0.0010 $');
  });
});

describe('tools and the cost of a day', () => {
  const row = (costUsd: number, toolCalls: number | null = null) => ({
    pass: true,
    error: null,
    inputTokens: 100,
    outputTokens: 20,
    costUsd,
    toolCalls,
    sample: '',
  });
  const day = (cost: number, toolCalls: number) => ({
    'situation-continues': row(cost),
    'hint-normal': row(cost),
    'resolve-normal': row(cost),
    'narrate-normal': row(cost, toolCalls),
    'extract-moments': row(cost),
    'compare-moments': row(cost),
  });

  it('keeps the tool calls a chapter made', () => {
    const summary = summarizeBench({
      results: {
        results: [
          {
            ...promptfooResult('narrate-normal', true),
            response: { output: '{}', metadata: { toolCalls: 2 } },
          },
          promptfooResult('hint-normal', true),
        ],
      },
    });

    expect(summary.cases['narrate-normal']?.toolCalls).toBe(2);
    expect(summary.cases['hint-normal']?.toolCalls).toBeNull();
  });

  it('reads a baseline saved before tool calls were kept', () => {
    const old = {
      pass: true,
      error: null,
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      sample: '',
    };
    const result = compareBench({ cases: { a: old } }, { cases: { a: row(0.001, 1) } });

    expect(result.lines[0]).toContain('tools 1');
  });

  it('prices a simulated day, with five hints, against 0.05 $', () => {
    const cheap = compareBench(undefined, { cases: day(0.001, 1) });
    expect(cheap.lines).toContain('simulated day: 0.0100 $ (limit 0.05 $), tool calls 1');
    expect(cheap.regressed).toBe(false);

    const dear = compareBench(undefined, { cases: day(0.01, 1) });
    expect(dear.lines).toContain(
      'simulated day: 0.1000 $ (limit 0.05 $), tool calls 1 ABOVE THE LIMIT',
    );
    expect(dear.regressed).toBe(true);
  });
});
