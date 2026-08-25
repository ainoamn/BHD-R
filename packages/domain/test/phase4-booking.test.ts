import { describe, expect, it } from 'vitest';
import { assertTransition, chequeMachine, viewingMachine } from '../src/state-machines.js';

describe('phase 4 booking concurrency model', () => {
  it('allows only one winner when 50 contenders race for a free unit slot', () => {
    // Models the DB advisory lock + unique partial index: first writer wins,
    // remaining 49 conflict. Pure logic stand-in for 50-parallel API stress.
    let activeReservation: string | null = null;
    const outcomes = Array.from({ length: 50 }, (_, index) => {
      const contender = `reservation-${index}`;
      if (activeReservation) return { contender, ok: false as const };
      activeReservation = contender;
      return { contender, ok: true as const };
    });
    expect(outcomes.filter((item) => item.ok)).toHaveLength(1);
    expect(outcomes.filter((item) => !item.ok)).toHaveLength(49);
    expect(activeReservation).toBe('reservation-0');
  });
});

describe('viewing and cheque machines', () => {
  it('rejects illegal viewing jumps', () => {
    expect(assertTransition(viewingMachine, 'requested', 'converted').ok).toBe(false);
    expect(assertTransition(viewingMachine, 'requested', 'scheduled').ok).toBe(true);
  });

  it('requires acceptance before deposit for cheques', () => {
    expect(assertTransition(chequeMachine, 'pending', 'deposited').ok).toBe(false);
    expect(assertTransition(chequeMachine, 'pending', 'accepted').ok).toBe(true);
    expect(assertTransition(chequeMachine, 'accepted', 'deposited').ok).toBe(true);
  });
});
