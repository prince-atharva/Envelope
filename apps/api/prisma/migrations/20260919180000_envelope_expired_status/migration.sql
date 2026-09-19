-- Phase 5, step 3 (docs/16): an overdue envelope pauses as EXPIRED (ADR 0013).
-- On its own migration because Postgres cannot use a new enum value in the
-- transaction that adds it, and the next migration's constraints name it.
ALTER TYPE "EnvelopeStatus" ADD VALUE 'EXPIRED' AFTER 'PARTIALLY_SIGNED';
