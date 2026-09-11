import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: 2,
  name: 'parameter-conflicts',
  up: `
ALTER TABLE parameters ADD COLUMN conflicts_json TEXT;
`,
};
