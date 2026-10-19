export type WorkTaskFollower = { userId: string; name: string; duty: string };
export type WorkTaskEvent = {
  id: string;
  type: string;
  note: string | null;
  at: string;
  actorName: string;
  fromStatus: string | null;
  toStatus: string | null;
  files: WorkTaskFile[];
};
export type WorkTaskSummary = {
  id: string;
  reference: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  startsAt: string | null;
  dueAt: string | null;
  assigneeName: string | null;
  tags: string[];
  checklistTotal: number;
  checklistDone: number;
};
export type WorkTaskFile = { id: string; name: string };
export type WorkTaskPlace = {
  property: { id: string; label: string } | null;
  unit: { id: string; label: string } | null;
  party: { id: string; label: string } | null;
};
export type WorkTaskSubject = {
  kind: 'party' | 'property' | 'unit';
  id: string;
  label: string;
};
export type WorkTaskChoice = { id: string; label: string; propertyId?: string };

/** Bidirectional reopen chain: previous closed tickets and successor reopenings. */
export type WorkTaskRelated = {
  id: string;
  reference: string;
  title: string;
  status: string;
  relation: 'previous' | 'next';
};

export type WorkTaskDetail = WorkTaskSummary & {
  description: string | null;
  completedAt: string | null;
  checklist: Array<{ label: string; done: boolean }>;
  assigneeId: string | null;
  followers: WorkTaskFollower[];
  files: WorkTaskFile[];
  subject: WorkTaskSubject | null;
  place: WorkTaskPlace;
  related: WorkTaskRelated[];
  events: WorkTaskEvent[];
  legalCase: { id: string; reference: string } | null;
  people: Array<{ userId: string; name: string }>;
  lawyers: Array<{ id: string; name: string }>;
  parties: WorkTaskChoice[];
  properties: WorkTaskChoice[];
  units: WorkTaskChoice[];
  canUpdate: boolean;
  canAssign: boolean;
  canLegal: boolean;
  canCreate: boolean;
};
