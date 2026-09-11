import { describe, expect, it } from 'vitest';

import { DatasheetRepository } from './datasheet-repository.js';
import { EscalationRepository } from './escalation-repository.js';
import { MIGRATIONS } from './migrations/index.js';
import { appliedMigrations } from './migrate.js';
import { NexarBudgetRepository } from './nexar-budget-repository.js';
import { OfferRepository } from './offer-repository.js';
import { createRepositories, openDatabase } from './open.js';
import { PartRepository } from './part-repository.js';
import { VerificationRepository } from './verification-repository.js';

describe('openDatabase', () => {
  it('opens and migrates', () => {
    const db = openDatabase(':memory:');
    expect(appliedMigrations(db).map((row) => row.name)).toEqual(
      MIGRATIONS.map((migration) => migration.name),
    );
    db.close();
  });
});

describe('createRepositories', () => {
  it('bundles one repository of each kind over the connection', () => {
    const db = openDatabase(':memory:');
    const repos = createRepositories(db);
    expect(repos.parts).toBeInstanceOf(PartRepository);
    expect(repos.offers).toBeInstanceOf(OfferRepository);
    expect(repos.datasheets).toBeInstanceOf(DatasheetRepository);
    expect(repos.verifications).toBeInstanceOf(VerificationRepository);
    expect(repos.escalations).toBeInstanceOf(EscalationRepository);
    expect(repos.nexarBudget).toBeInstanceOf(NexarBudgetRepository);
    expect(repos.nexarBudget.limit()).toBe(90);
    db.close();
  });
});
