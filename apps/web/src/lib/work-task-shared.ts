export type WorkTaskFollower = { userId: string; name: string; duty: string };
export type WorkTaskEvent = {
  id: string;
  type: string;
  note: string | null;
  at: string;
  actorName: string;
};
export type WorkTaskSummary = {
  id: string;
  reference: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  dueAt: string | null;
  assigneeName: string | null;
};
export type WorkTaskFile = { id: string; name: string };
export type WorkTaskSubject = {
  kind: 'party' | 'property' | 'unit';
  id: string;
  label: string;
};
export type WorkTaskChoice = { id: string; label: string; propertyId?: string };

export type WorkTaskDetail = WorkTaskSummary & {
  description: string | null;
  completedAt: string | null;
  checklist: Array<{ label: string; done: boolean }>;
  assigneeId: string | null;
  followers: WorkTaskFollower[];
  files: WorkTaskFile[];
  subject: WorkTaskSubject | null;
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
};
