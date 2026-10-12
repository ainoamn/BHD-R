'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  ROLE_LABELS,
  roleLabel,
  TEAM_CAPABILITIES,
  validTeamEmail,
  type TeamMember,
  type TeamView,
} from '@/lib/team-shared';

const ERRORS: Record<string, [string, string]> = {
  team_seat_limit: [
    'وصلت إلى حد المقاعد في باقتك. عطّل عضواً أو رقِّ الباقة.',
    'Your plan’s seat limit is reached. Disable a member or upgrade.',
  ],
  team_role_not_allowed: [
    'لا يمكنك منح هذا الدور أو تعديل هذا العضو.',
    'You cannot give this role or change this member.',
  ],
  team_self_change: ['لا يمكنك تعديل صلاحياتك بنفسك.', 'You cannot change your own access.'],
  team_owner_locked: ['صلاحيات المالك ثابتة.', 'The owner’s access cannot be changed.'],
  team_member_exists: ['هذا البريد عضو في الفريق بالفعل.', 'This email is already on the team.'],
  team_member_not_found: ['العضو غير موجود.', 'Member not found.'],
  team_email_invalid: ['البريد الإلكتروني غير صحيح.', 'The email is invalid.'],
  forbidden: ['لا تملك صلاحية إدارة الفريق.', 'You cannot manage the team.'],
  rate_limited: ['محاولات كثيرة، انتظر دقيقة.', 'Too many attempts; wait a minute.'],
};

function errorText(error: unknown, ar: boolean): string {
  const code = error instanceof ApiError ? error.code : '';
  const known = ERRORS[code];
  if (known) return ar ? known[0] : known[1];
  if (error instanceof ApiError && error.status === 0) return error.message;
  return ar ? 'تعذر حفظ التغيير. أعد المحاولة.' : 'Could not save. Try again.';
}

function CapabilityPicker({
  ar,
  role,
  view,
  selected,
  onChange,
}: {
  ar: boolean;
  role: string;
  view: TeamView;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const included = new Set(view.roleCapabilities[role] ?? []);
  const grantable = new Set(view.grantableCapabilities);
  return (
    <fieldset className="team-caps">
      <legend>{ar ? 'صلاحيات إضافية على الدور' : 'Extra permissions on top of the role'}</legend>
      {TEAM_CAPABILITIES.map((capability) => {
        const inRole = included.has(capability.id);
        const allowed = grantable.has(capability.id);
        const checked = inRole || selected.includes(capability.id);
        return (
          <label
            key={capability.id}
            className={
              inRole ? 'team-cap is-included' : allowed ? 'team-cap' : 'team-cap is-locked'
            }
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={inRole || !allowed}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, capability.id]
                    : selected.filter((id) => id !== capability.id),
                )
              }
            />
            <span>{ar ? capability.ar : capability.en}</span>
            {inRole ? <small>{ar ? 'ضمن الدور' : 'In role'}</small> : null}
          </label>
        );
      })}
    </fieldset>
  );
}

function RoleSelect({
  ar,
  roles,
  value,
  onChange,
}: {
  ar: boolean;
  roles: string[];
  value: string;
  onChange: (role: string) => void;
}) {
  const hint = ROLE_LABELS[value];
  return (
    <label className="team-field">
      <span>{ar ? 'الدور' : 'Role'}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {roles.map((role) => (
          <option key={role} value={role}>
            {roleLabel(role, ar)}
          </option>
        ))}
      </select>
      {hint ? <small>{ar ? hint.hintAr : hint.hintEn}</small> : null}
    </label>
  );
}

function AddMemberForm({
  ar,
  view,
  onDone,
}: {
  ar: boolean;
  view: TeamView;
  onDone: (message: string) => void;
}) {
  const defaultRole = view.assignableRoles.includes('finance_manager')
    ? 'finance_manager'
    : (view.assignableRoles[0] ?? '');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(defaultRole);
  const [extras, setExtras] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = view.seats.used >= view.seats.limit;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validTeamEmail(email)) {
      setError(ERRORS.team_email_invalid![ar ? 0 : 1]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await browserNextMutation<{ existingAccount: boolean }>('/api/owner/team', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          ...(name.trim() ? { displayName: name.trim() } : {}),
          role,
          capabilities: extras.filter((id) => !(view.roleCapabilities[role] ?? []).includes(id)),
        }),
      });
      setEmail('');
      setName('');
      setExtras([]);
      onDone(
        ar
          ? result.existingAccount
            ? 'أُضيف العضو. سيجد الفريق في قائمة حسابه عند دخوله.'
            : 'أُضيف العضو وأُرسل له بريد. ينضم عند أول دخول بحساب BHD بنفس البريد.'
          : result.existingAccount
            ? 'Member added. They will find the team in their account menu.'
            : 'Member added and emailed. They join on first BHD sign-in with that email.',
      );
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="team-card team-add" onSubmit={(event) => void submit(event)}>
      <h2>{ar ? 'إضافة عضو للفريق' : 'Add a team member'}</h2>
      <p className="team-muted">
        {ar
          ? 'أدخل البريد الذي يستخدمه في حساب BHD. يدخل بنفس البريد فتظهر له أعمالك حسب صلاحياته فقط.'
          : 'Use the email of their BHD account. They sign in with it and see only what their access allows.'}
      </p>
      <div className="team-add__grid">
        <label className="team-field">
          <span>{ar ? 'البريد الإلكتروني' : 'Email'}</span>
          <input
            type="email"
            dir="ltr"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
        </label>
        <label className="team-field">
          <span>{ar ? 'الاسم (اختياري)' : 'Name (optional)'}</span>
          <input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
        </label>
        <RoleSelect
          ar={ar}
          roles={view.assignableRoles}
          value={role}
          onChange={(next) => {
            setRole(next);
            setExtras([]);
          }}
        />
      </div>
      <CapabilityPicker ar={ar} role={role} view={view} selected={extras} onChange={setExtras} />
      {error ? <p className="team-error">{error}</p> : null}
      <div className="team-actions">
        <button className="button button--primary" type="submit" disabled={busy || full || !role}>
          {busy ? (ar ? 'جارٍ الإضافة…' : 'Adding…') : ar ? 'إضافة للفريق' : 'Add to team'}
        </button>
        {full ? (
          <small className="team-muted">
            {ar ? 'لا مقاعد متاحة في باقتك.' : 'No seats left on your plan.'}
          </small>
        ) : null}
      </div>
    </form>
  );
}

function MemberRow({
  ar,
  member,
  view,
  onChanged,
}: {
  ar: boolean;
  member: TeamMember;
  view: TeamView;
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(member.role);
  const [extras, setExtras] = useState(member.extras);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = member.role === 'organization_owner';
  const manageable =
    view.canManage &&
    !owner &&
    !member.isSelf &&
    (view.assignableRoles as string[]).includes(member.role);
  const roleIncluded = new Set(view.roleCapabilities[member.role] ?? []);
  const extraLabels = member.extras
    .filter((id) => !roleIncluded.has(id))
    .map((id) => TEAM_CAPABILITIES.find((capability) => capability.id === id))
    .filter((capability) => capability !== undefined);

  const send = async (method: 'PATCH' | 'DELETE', body: object | null, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(`/api/owner/team/${encodeURIComponent(member.userId)}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setEditing(false);
      onChanged(done);
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel =
    member.status !== 'active'
      ? ar
        ? 'معطّل'
        : 'Disabled'
      : member.signedIn
        ? ar
          ? 'نشط'
          : 'Active'
        : ar
          ? 'بانتظار أول دخول'
          : 'Awaiting first sign-in';

  return (
    <li className={member.status === 'active' ? 'team-member' : 'team-member is-inactive'}>
      <div className="team-member__head">
        <span className="team-member__initial" aria-hidden="true">
          {member.displayName.trim().slice(0, 1) || '•'}
        </span>
        <div className="team-member__who">
          <strong>
            {member.displayName}
            {member.isSelf ? <em>{ar ? ' (أنت)' : ' (you)'}</em> : null}
          </strong>
          <small dir="ltr">{member.email}</small>
        </div>
        <span className={`team-role team-role--${member.role}`}>{roleLabel(member.role, ar)}</span>
        <span
          className={
            member.status !== 'active'
              ? 'team-status is-off'
              : member.signedIn
                ? 'team-status is-on'
                : 'team-status is-pending'
          }
        >
          {statusLabel}
        </span>
      </div>
      {extraLabels.length > 0 ? (
        <div className="team-member__extras">
          <span>{ar ? 'إضافية:' : 'Extra:'}</span>
          {extraLabels.map((capability) => (
            <i key={capability.id}>{ar ? capability.ar : capability.en}</i>
          ))}
        </div>
      ) : null}
      {manageable && !editing ? (
        <div className="team-actions">
          <button
            type="button"
            className="ops-action"
            disabled={busy}
            onClick={() => {
              setRole(member.role);
              setExtras(member.extras);
              setEditing(true);
            }}
          >
            {ar ? 'تعديل الدور والصلاحيات' : 'Edit role & access'}
          </button>
          <button
            type="button"
            className="ops-action"
            disabled={busy}
            onClick={() =>
              void send(
                'PATCH',
                { status: member.status === 'active' ? 'inactive' : 'active' },
                member.status === 'active'
                  ? ar
                    ? 'عُطّل العضو وخرج من جلساته.'
                    : 'Member disabled and signed out.'
                  : ar
                    ? 'أُعيد تفعيل العضو.'
                    : 'Member reactivated.',
              )
            }
          >
            {member.status === 'active' ? (ar ? 'تعطيل' : 'Disable') : ar ? 'تفعيل' : 'Reactivate'}
          </button>
          <button
            type="button"
            className="ops-action ops-action--danger"
            disabled={busy}
            onClick={() => {
              const ok = window.confirm(
                ar
                  ? `إزالة ${member.displayName} من الفريق؟ يبقى حسابه في BHD لكنه لن يرى أعمالك.`
                  : `Remove ${member.displayName} from the team? Their BHD account stays.`,
              );
              if (ok) {
                void send('DELETE', null, ar ? 'أُزيل العضو من الفريق.' : 'Member removed.');
              }
            }}
          >
            {ar ? 'إزالة' : 'Remove'}
          </button>
        </div>
      ) : null}
      {editing ? (
        <div className="team-edit">
          <RoleSelect
            ar={ar}
            roles={view.assignableRoles}
            value={role}
            onChange={(next) => setRole(next)}
          />
          <CapabilityPicker
            ar={ar}
            role={role}
            view={view}
            selected={extras}
            onChange={setExtras}
          />
          <div className="team-actions">
            <button
              type="button"
              className="button button--primary button--tiny"
              disabled={busy}
              onClick={() =>
                void send(
                  'PATCH',
                  {
                    role,
                    capabilities: extras.filter(
                      (id) => !(view.roleCapabilities[role] ?? []).includes(id),
                    ),
                  },
                  ar
                    ? 'حُفظت الصلاحيات. تسري على العضو فوراً.'
                    : 'Access saved; it applies right away.',
                )
              }
            >
              {ar ? 'حفظ' : 'Save'}
            </button>
            <button
              type="button"
              className="button button--quiet button--tiny"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="team-error">{error}</p> : null}
    </li>
  );
}

/** Owner/admin team: who works on the organization's properties and with what access. */
export function TeamManager({ locale, active }: { locale: 'ar' | 'en'; active: boolean }) {
  const ar = locale === 'ar';
  const [view, setView] = useState<TeamView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/owner/team', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (response.status === 403) {
        setFailed('forbidden');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setView((await response.json()) as TeamView);
      setFailed(null);
    } catch {
      setFailed('load');
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const changed = (message: string) => {
    setNotice(message);
    void load();
  };

  return (
    <div className="team-page">
      <header className="portal-topbar">
        <div>
          <h1>{ar ? 'الفريق والصلاحيات' : 'Team & access'}</h1>
          <p>
            {ar
              ? 'أضف مديرين ومحاسبين وفنيي صيانة لإدارة عقاراتك، ولكل منهم صلاحياته.'
              : 'Add administrators, accountants and maintenance staff, each with their own access.'}
          </p>
        </div>
        {view ? (
          <div className="team-seats" title={ar ? 'المقاعد في باقتك' : 'Seats on your plan'}>
            <strong>
              {view.seats.used} / {view.seats.limit}
            </strong>
            <small>{ar ? 'مقاعد الفريق' : 'team seats'}</small>
          </div>
        ) : null}
      </header>

      {notice ? (
        <p className="team-notice" role="status">
          {notice}
        </p>
      ) : null}

      {failed === 'forbidden' ? (
        <p className="team-card team-muted">
          {ar
            ? 'إدارة الفريق متاحة للمالك والمدير الإداري فقط.'
            : 'Team management is for the owner and administrators.'}
        </p>
      ) : failed ? (
        <p className="team-card team-error">
          {ar ? 'تعذر تحميل الفريق.' : 'Could not load the team.'}{' '}
          <button type="button" className="ops-action" onClick={() => void load()}>
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </p>
      ) : !view ? (
        <p className="team-card team-muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : (
        <div className="team-layout">
          <section className="team-card">
            <h2>
              {ar ? 'أعضاء الفريق' : 'Team members'} <small>({view.members.length})</small>
            </h2>
            <ul className="team-list">
              {view.members.map((member) => (
                <MemberRow
                  key={`${member.userId}:${member.role}:${member.status}:${member.extras.join(',')}`}
                  ar={ar}
                  member={member}
                  view={view}
                  onChanged={changed}
                />
              ))}
            </ul>
          </section>
          {view.canManage && view.assignableRoles.length > 0 ? (
            <AddMemberForm ar={ar} view={view} onDone={changed} />
          ) : null}
          <details className="team-card team-guide">
            <summary>{ar ? 'دليل الأدوار' : 'Roles guide'}</summary>
            <dl>
              {Object.entries(ROLE_LABELS).map(([role, label]) => (
                <div key={role}>
                  <dt>{ar ? label.ar : label.en}</dt>
                  <dd>{ar ? label.hintAr : label.hintEn}</dd>
                </div>
              ))}
            </dl>
            <p className="team-muted">
              {ar
                ? 'تحويل التأمين يتم من تبويب «الحسابات» بيد المحاسب، واعتماد الاسترداد بيد المالك أو من تمنحه الصلاحية.'
                : 'Deposit transfers happen in Accounting by the accountant; refund approval by the owner or whoever you grant it.'}
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
