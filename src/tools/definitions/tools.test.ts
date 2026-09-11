import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type TestHarness } from '../../../test/helpers/tool-context.js';
import type { ToolRegistry } from '../registry.js';
import { buildRegistry } from './index.js';

let harness: TestHarness;
let registry: ToolRegistry;

beforeEach(async () => {
  harness = await createHarness();
  registry = buildRegistry();
});

afterEach(async () => {
  await harness.close();
});

describe('the tool surface', () => {
  it('holds every tool the completion plan names', () => {
    expect(registry.names()).toEqual([
      'ask_human',
      'cache_stats',
      'classify_part',
      'fetch_datasheet',
      'fetch_offers',
      'find_alternates',
      'find_pages',
      'get_part',
      'list_escalations',
      'nexar_budget_status',
      'normalise_value',
      'pdf_info',
      'read_pages',
      'reconcile_parameters',
      'record_verification',
      'render_page',
      'resolve_mpn',
      'search_parts',
      'upsert_part',
    ]);
  });

  it('gates exactly the tools that spend distributor quota', () => {
    const spending = registry
      .list()
      .filter((tool) => tool.spendsQuota)
      .map((tool) => tool.name);
    expect(spending).toEqual(['fetch_offers', 'resolve_mpn']);
  });

  it('describes every tool', () => {
    for (const tool of registry.list()) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});
