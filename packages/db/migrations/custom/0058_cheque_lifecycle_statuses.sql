-- Expand cheque lifecycle: postpone, insufficient funds, partial clear + collected amount.
ALTER TYPE "cheque_review_status" ADD VALUE IF NOT EXISTS 'postponed';
ALTER TYPE "cheque_review_status" ADD VALUE IF NOT EXISTS 'insufficient_funds';
ALTER TYPE "cheque_review_status" ADD VALUE IF NOT EXISTS 'partially_cleared';

ALTER TABLE "cheques"
  ADD COLUMN IF NOT EXISTS "collected_minor" bigint;
