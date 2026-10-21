/**
 * Parent contracts keep CTR-YYYY-NNNNNN.
 * Linked addenda / renewals / terminations use CTR-YYYY-NNNNNN-02, -03, …
 * (first child is -02 so the parent remains the implied -01).
 */

const CHILD_SUFFIX = /^(.*)-(\d{2})$/;

/** Build a child reference under a parent, e.g. CTR-2026-000001-02. */
export function formatChildContractReference(parentReference: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 2) {
    throw new Error('Child contract sequence must be an integer ≥ 2');
  }
  const parent = parentReference.trim();
  if (!parent) throw new Error('Parent contract reference is required');
  return `${parent}-${String(sequence).padStart(2, '0')}`;
}

/** Parse the numeric suffix when `reference` is a direct child of `parentReference`. */
export function parseChildContractSequence(
  reference: string,
  parentReference: string,
): number | null {
  const parent = parentReference.trim();
  const ref = reference.trim();
  if (!parent || !ref.startsWith(`${parent}-`)) return null;
  const match = CHILD_SUFFIX.exec(ref);
  if (!match || match[1] !== parent) return null;
  const sequence = Number(match[2]);
  return Number.isInteger(sequence) && sequence >= 2 ? sequence : null;
}

/** Whether a reference already follows the parent-suffix scheme. */
export function isChildContractReference(reference: string, parentReference: string): boolean {
  return parseChildContractSequence(reference, parentReference) !== null;
}

/**
 * Next child sequence from existing sibling references (starts at 2).
 * Ignores annex-style suffixes like -A1.
 */
export function nextChildContractSequence(
  parentReference: string,
  siblingReferences: readonly string[],
): number {
  let max = 1;
  for (const sibling of siblingReferences) {
    const sequence = parseChildContractSequence(sibling, parentReference);
    if (sequence !== null && sequence > max) max = sequence;
  }
  return max + 1;
}
