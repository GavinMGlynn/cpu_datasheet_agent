import { Db, type OpenOptions } from './database.js';
import { DatasheetRepository } from './datasheet-repository.js';
import { EscalationRepository } from './escalation-repository.js';
import { applyMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';
import { NexarBudgetRepository } from './nexar-budget-repository.js';
import { OfferRepository } from './offer-repository.js';
import { PartRepository } from './part-repository.js';
import { VerificationRepository } from './verification-repository.js';

/** Opens a connection and brings the schema up to date. */
export function openDatabase(path: string, options: OpenOptions = {}): Db {
  const db = new Db(path, options);
  applyMigrations(db, MIGRATIONS);
  return db;
}

export interface Repositories {
  readonly parts: PartRepository;
  readonly offers: OfferRepository;
  readonly datasheets: DatasheetRepository;
  readonly verifications: VerificationRepository;
  readonly escalations: EscalationRepository;
  readonly nexarBudget: NexarBudgetRepository;
}

export function createRepositories(db: Db): Repositories {
  return {
    parts: new PartRepository(db),
    offers: new OfferRepository(db),
    datasheets: new DatasheetRepository(db),
    verifications: new VerificationRepository(db),
    escalations: new EscalationRepository(db),
    nexarBudget: new NexarBudgetRepository(db),
  };
}
