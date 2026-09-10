import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: 1,
  name: 'initial',
  up: `
CREATE TABLE datasheets (
  sha256 TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  local_path TEXT NOT NULL
);

CREATE TABLE datasheet_mpns (
  sha256 TEXT NOT NULL REFERENCES datasheets(sha256) ON DELETE CASCADE,
  mpn TEXT NOT NULL,
  PRIMARY KEY (sha256, mpn)
);
CREATE INDEX datasheet_mpns_mpn ON datasheet_mpns(mpn);

CREATE TABLE parts (
  id INTEGER PRIMARY KEY,
  mpn TEXT NOT NULL UNIQUE,
  manufacturer TEXT NOT NULL,
  category TEXT NOT NULL,
  datasheet_sha256 TEXT REFERENCES datasheets(sha256),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX parts_status ON parts(status);
CREATE INDEX parts_category ON parts(category);

CREATE TABLE parameters (
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  numeric_min REAL,
  numeric_max REAL,
  unit TEXT,
  provenance_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  PRIMARY KEY (part_id, key)
);
CREATE INDEX parameters_key_numeric ON parameters(key, numeric_min, numeric_max);

CREATE TABLE offers (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  distributor TEXT NOT NULL,
  sku TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  mpn_as_listed TEXT NOT NULL,
  currency TEXT NOT NULL,
  stock INTEGER NOT NULL,
  moq INTEGER NOT NULL,
  packaging TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  UNIQUE (part_id, distributor, sku)
);

CREATE TABLE price_breaks (
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  PRIMARY KEY (offer_id, quantity)
);

CREATE TABLE classifications (
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  axis TEXT NOT NULL,
  value_json TEXT NOT NULL,
  derived_from_json TEXT NOT NULL,
  rule TEXT NOT NULL,
  PRIMARY KEY (part_id, axis)
);
CREATE INDEX classifications_axis_value ON classifications(axis, value_json);

CREATE TABLE verifications (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  parameter_key TEXT NOT NULL,
  verdict TEXT NOT NULL,
  quote TEXT,
  page INTEGER NOT NULL,
  checked_at TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL
);
CREATE INDEX verifications_part ON verifications(part_id, parameter_key);

CREATE TABLE escalations (
  id TEXT PRIMARY KEY,
  mpn TEXT NOT NULL,
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  context_json TEXT NOT NULL,
  options_json TEXT,
  created_at TEXT NOT NULL,
  resolution_json TEXT
);
CREATE INDEX escalations_open ON escalations(mpn) WHERE resolution_json IS NULL;

CREATE TABLE nexar_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  used INTEGER NOT NULL DEFAULT 0,
  limit_value INTEGER NOT NULL
);
INSERT INTO nexar_budget (id, used, limit_value) VALUES (1, 0, 90);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  mpn TEXT NOT NULL,
  kind TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  session_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  turns INTEGER,
  cost_usd REAL,
  result TEXT,
  details_json TEXT
);
CREATE INDEX runs_mpn ON runs(mpn, kind, prompt_version);
`,
};
