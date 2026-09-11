import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ESCALATION_KINDS, PART_STATUSES, ValidationError } from '../core/index.js';
import { buildRegistry } from '../tools/index.js';
import { PromptError, extractionRequest, loadPrompt, loadPromptFrom } from './prompt.js';

/** Tools the extraction prompt must walk the agent through. */
const REQUIRED = [
  'resolve_mpn',
  'fetch_offers',
  'fetch_datasheet',
  'find_pages',
  'read_pages',
  'render_page',
  'normalise_value',
  'reconcile_parameters',
  'classify_part',
  'upsert_part',
  'ask_human',
];

describe('loadPrompt', () => {
  it('reads extract.v1 and reports its digest', async () => {
    const prompt = await loadPrompt('extract.v1');

    expect(prompt.version).toBe('extract.v1');
    expect(prompt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(prompt.text).toBe(prompt.text.trimEnd());
    expect(prompt.text).toMatchSnapshot();
  });

  it('names only tools that exist, and every tool the run needs', async () => {
    const { text } = await loadPrompt('extract.v1');
    // A snake_case word in backticks is a tool, a part status or an
    // escalation kind. Anything else is a name that has drifted.
    const vocabulary = new Set([...buildRegistry().names(), ...PART_STATUSES, ...ESCALATION_KINDS]);

    const mentioned = [...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map(
      (match) => match[1] ?? '',
    );

    expect([...new Set(mentioned)].filter((name) => !vocabulary.has(name))).toEqual([]);
    for (const required of REQUIRED) {
      expect(text).toContain(required);
    }
  });

  it('reads verify.v1, which tells the reader to decide and not to fix', async () => {
    const prompt = await loadPrompt('verify.v1');
    const names = new Set(buildRegistry().names());

    expect(prompt.version).toBe('verify.v1');
    expect(prompt.text).toContain('confirmed');
    expect(prompt.text).toContain('contradicted');
    expect(prompt.text).toContain('not_found');
    expect(prompt.text).toContain('You do not correct anything');
    for (const tool of ['read_pages', 'render_page', 'record_verification']) {
      expect(names.has(tool)).toBe(true);
      expect(prompt.text).toContain(tool);
    }
    expect(prompt.text).toMatchSnapshot();
  });

  it('states the rules that are not negotiable', async () => {
    const { text } = await loadPrompt('extract.v1');

    expect(text).toContain('No page, no store');
    expect(text).toContain('Nothing is coerced');
    expect(text).toContain('Escalate rather than decide');
    expect(text).toContain('render_page');
    expect(text).toContain('covers a whole family');
  });

  it('refuses a version that is not one', async () => {
    await expect(loadPrompt('extract')).rejects.toThrow(ValidationError);
    await expect(loadPrompt('../secrets.v1')).rejects.toThrow(ValidationError);
  });

  it('refuses a version with no file, and an empty file', async () => {
    await expect(loadPrompt('extract.v99')).rejects.toThrow(PromptError);

    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-'));
    try {
      await writeFile(path.join(dir, 'blank.v1.md'), '   \n');
      await expect(loadPromptFrom(dir, 'blank.v1')).rejects.toThrow(PromptError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('extractionRequest', () => {
  it('asks for one part by number', () => {
    expect(extractionRequest('TPS54331DR')).toContain('TPS54331DR');
  });
});
