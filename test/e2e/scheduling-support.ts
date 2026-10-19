import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

export const schedulingFixtureIds = {
  tenantA: '10000000-0000-4000-8000-000000000001',
  tenantB: '10000000-0000-4000-8000-000000000002',
  administrator: '30000000-0000-4000-8000-000000000001',
  member: '30000000-0000-4000-8000-000000000002',
  service: '40000000-0000-4000-8000-000000000001',
  professional: '50000000-0000-4000-8000-000000000001',
  appointment: '70000000-0000-4000-8000-000000000001',
} as const;

export async function seedSchedulingFixture(pool: Pool): Promise<void> {
  await pool.query(await readFile('database/tests/fixtures/scheduling.sql', 'utf8'));
}

export class SchedulingTestClock {
  constructor(private value: Date) {}
  now(): Date { return new Date(this.value); }
  set(value: Date): void { this.value = new Date(value); }
  advance(milliseconds: number): void { this.value = new Date(this.value.getTime() + milliseconds); }
}
