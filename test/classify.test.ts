import { describe, it, expect } from 'vitest';
import { classifyTask, DEFAULT_TIER } from '../src/optimizer/classify';

describe('classifyTask buckets', () => {
  it('classify/extract/yes-no/route -> trivial', () => {
    expect(classifyTask('Classify whether this diff touches auth code').tier).toBe('trivial');
    expect(classifyTask('Extract the invoice number').tier).toBe('trivial');
    expect(classifyTask('Is this a yes or no question').tier).toBe('trivial');
    expect(classifyTask('Route this request to a queue').tier).toBe('trivial');
  });

  it('summarise/draft/rename -> fast', () => {
    expect(classifyTask('Summarise this PR').tier).toBe('fast');
    expect(classifyTask('Draft a short reply').tier).toBe('fast');
    expect(classifyTask('Rename this variable').tier).toBe('fast');
  });

  it('refactor/plan/multi-file/design -> standard', () => {
    expect(classifyTask('Refactor this module').tier).toBe('standard');
    expect(classifyTask('Plan the migration').tier).toBe('standard');
    expect(classifyTask('A multi-file change across the service').tier).toBe('standard');
    expect(classifyTask('Design the data model').tier).toBe('standard');
  });

  it('prove/architecture/hard-debug -> reasoning', () => {
    expect(classifyTask('Prove this invariant holds').tier).toBe('reasoning');
    expect(classifyTask('Redesign the system architecture').tier).toBe('reasoning');
    expect(classifyTask('Debug a hard bug in the scheduler').tier).toBe('reasoning');
  });

  it('defaults to fast when nothing matches', () => {
    const r = classifyTask('do the thing');
    expect(r.tier).toBe(DEFAULT_TIER);
    expect(r.reason).toMatch(/default/i);
  });

  it('always returns a reason naming the matched keyword', () => {
    const r = classifyTask('Classify this');
    expect(r.reason).toMatch(/classify/i);
  });

  it('stronger-tier keywords win over weaker ones in the same text', () => {
    /* "design" (standard) and "architecture" (reasoning) both present -> reasoning. */
    expect(classifyTask('Design the architecture of the system').tier).toBe('reasoning');
  });

  it('a long prompt bumps the tier up one step', () => {
    const long = 'Summarise this. ' + 'x'.repeat(7000);
    /* summarise -> fast, then size bump -> standard. */
    expect(classifyTask(long).tier).toBe('standard');
  });

  it('honors an overriding ruleset', () => {
    const r = classifyTask('frobnicate the widget', {
      rules: [{ tier: 'reasoning', keywords: ['frobnicate'] }],
    });
    expect(r.tier).toBe('reasoning');
  });
});
