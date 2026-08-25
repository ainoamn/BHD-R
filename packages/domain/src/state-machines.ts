/**
 * Machine-readable status transitions for BHD R domain aggregates.
 * Services must reject jumps not listed in `transitions`.
 */

export type StateMachine = {
  name: string;
  initial: string;
  terminals: readonly string[];
  transitions: Readonly<Record<string, readonly string[]>>;
};

export function assertTransition(
  machine: StateMachine,
  from: string,
  to: string,
): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: true };
  const allowed = machine.transitions[from];
  if (!allowed) return { ok: false, reason: `Unknown source state ${from} for ${machine.name}` };
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `Illegal ${machine.name} transition ${from} → ${to}`,
    };
  }
  return { ok: true };
}

export const reservationMachine: StateMachine = {
  name: 'reservation',
  initial: 'draft',
  terminals: ['converted', 'cancelled', 'expired', 'rejected'],
  transitions: {
    draft: ['submitted', 'cancelled'],
    submitted: ['payment_pending', 'compliance_pending', 'rejected', 'cancelled'],
    payment_pending: ['payment_confirmed', 'cancelled', 'expired'],
    payment_confirmed: ['compliance_pending', 'cancelled'],
    compliance_pending: ['ready_for_contract', 'rejected', 'cancelled'],
    ready_for_contract: ['converted', 'cancelled'],
  },
};

export const contractMachine: StateMachine = {
  name: 'contract',
  initial: 'draft',
  terminals: ['active', 'rejected', 'cancelled', 'expired', 'terminated'],
  transitions: {
    draft: ['compliance_ready', 'cancelled'],
    compliance_ready: ['admin_approved', 'rejected', 'cancelled'],
    admin_approved: ['tenant_signature_pending', 'rejected', 'cancelled'],
    tenant_signature_pending: ['owner_signature_pending', 'cancelled', 'expired'],
    owner_signature_pending: ['final_review', 'cancelled', 'expired'],
    final_review: ['active', 'rejected', 'cancelled'],
    active: ['termination_pending'],
    termination_pending: ['terminated', 'active'],
  },
};

export const journalMachine: StateMachine = {
  name: 'journal_entry',
  initial: 'draft',
  terminals: ['posted', 'reversed'],
  transitions: {
    draft: ['posted', 'void'],
    posted: ['reversed'],
  },
};

export const maintenanceTicketMachine: StateMachine = {
  name: 'maintenance_ticket',
  initial: 'reported',
  terminals: ['closed', 'cancelled'],
  transitions: {
    reported: ['triaged', 'cancelled'],
    triaged: ['quote_requested', 'approval_pending', 'scheduled', 'cancelled'],
    quote_requested: ['approval_pending', 'cancelled'],
    approval_pending: ['approved', 'rejected', 'cancelled'],
    approved: ['scheduled', 'cancelled'],
    scheduled: ['in_progress', 'cancelled'],
    in_progress: ['work_completed', 'cancelled'],
    work_completed: ['verified', 'reopened'],
    verified: ['invoiced', 'closed'],
    invoiced: ['closed'],
    rejected: ['triaged', 'cancelled'],
    reopened: ['triaged', 'scheduled'],
  },
};

export const viewingMachine: StateMachine = {
  name: 'viewing_request',
  initial: 'requested',
  terminals: ['converted', 'cancelled'],
  transitions: {
    requested: ['scheduled', 'cancelled'],
    scheduled: ['completed', 'no_show', 'cancelled'],
    completed: ['converted'],
    no_show: ['scheduled', 'cancelled'],
  },
};

export const leadMachine: StateMachine = {
  name: 'lead',
  initial: 'new',
  terminals: ['converted', 'lost', 'cancelled'],
  transitions: {
    new: ['contacted', 'qualified', 'lost', 'cancelled'],
    contacted: ['qualified', 'lost', 'cancelled'],
    qualified: ['converted', 'lost', 'cancelled'],
  },
};

export const chequeMachine: StateMachine = {
  name: 'cheque',
  initial: 'pending',
  terminals: ['cleared', 'bounced', 'cancelled'],
  transitions: {
    pending: ['accepted', 'rejected', 'cancelled'],
    accepted: ['deposited', 'cancelled'],
    deposited: ['cleared', 'bounced'],
    rejected: ['pending', 'cancelled'],
  },
};

export const STATE_MACHINES = {
  reservation: reservationMachine,
  contract: contractMachine,
  journal_entry: journalMachine,
  maintenance_ticket: maintenanceTicketMachine,
  viewing_request: viewingMachine,
  lead: leadMachine,
  cheque: chequeMachine,
} as const;
