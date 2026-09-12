import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { AuditRepository } from './audit-repository.js';
import { Db, type OpenOptions } from './database.js';
import { DatasheetRepository } from './datasheet-repository.js';
import { EscalationRepository } from './escalation-repository.js';
import { applyMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';
import { NexarBudgetRepository } from './nexar-budget-repository.js';
import { OfferRepository } from './offer-repository.js';
import { PartRepository } from './part-repository.js';
import { RunRepository } from './run-repository.js';
import { VerificationRepository } from './verification-repository.js';

/**
 * Opens a connection and brings the schema up to date.
 *
 * The directory is created if it is not there: a database is a file, a file
 * needs somewhere to live, and "cannot open database because the directory
 * does not exist" is a worse answer than making the directory. The evaluation
 * harness gives each run a database of its own under a directory nothing has
 * written to yet, and so does a first run on a new machine.
 */
export function openDatabase(file: string, options: OpenOptions = {}): Db {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Db(file, options);
  applyMigrations(db, MIGRATIONS);
  return db;
}

export interface Repositories {
  readonly audit: AuditRepository;
  readonly parts: PartRepository;
  readonly offers: OfferRepository;
  readonly datasheets: DatasheetRepository;
  readonly verifications: VerificationRepository;
  readonly escalations: EscalationRepository;
  readonly runs: RunRepository;
  readonly nexarBudget: NexarBudgetRepository;
}

export function createRepositories(db: Db): Repositories {
  return {
    audit: new AuditRepository(db),
    parts: new PartRepository(db),
    offers: new OfferRepository(db),
    datasheets: new DatasheetRepository(db),
    verifications: new VerificationRepository(db),
    escalations: new EscalationRepository(db),
    runs: new RunRepository(db),
    nexarBudget: new NexarBudgetRepository(db),
  };
}
