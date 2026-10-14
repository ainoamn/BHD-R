'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { BadgeChips } from '@/components/badges/badge-chips';
import { IdentityAvatar, VerifiedMark } from '@/components/identity/verified-mark';
import { ApiError, browserNextMutation } from '@/lib/api';
import { badgeSubjectKey } from '@/lib/badges-shared';
import type { IdentityMark } from '@/lib/identity-shared';
import {
  CAPABILITY_GROUPS,
  isCustomRoleKey,
  ROLE_GROUPS,
  ROLE_LABELS,
  roleLabel,
  savedRoleKey,
  TEAM_CAPABILITIES,
  validTeamEmail,
  type LawyerMember,
  type PropertyOwnerMember,
  type SavedRole,
  type TeamMember,
  type TeamView,
  type TenantMember,
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
  team_member_exists: ['هذا البريد مضاف بالفعل.', 'This email is already added.'],
  team_member_not_found: ['العضو غير موجود.', 'Member not found.'],
  team_email_invalid: ['البريد الإلكتروني غير صحيح.', 'The email is invalid.'],
  team_roles_required: ['اختر دوراً واحداً على الأقل.', 'Choose at least one role.'],
  team_owner_party_required: [
    'اختر المالك من ملاك العقارات المسجلين.',
    'Choose the owner from the registered property owners.',
  ],
  team_lawyer_invalid: [
    'اختر المحامي أو المكتب من القائمة.',
    'Choose the lawyer or firm from the list.',
  ],
  team_role_invalid: [
    'أدخل اسماً للدور واختر صلاحية واحدة على الأقل.',
    'Name the role and choose at least one permission.',
  ],
  team_role_not_found: ['الدور غير موجود.', 'Role not found.'],
  team_role_limit: [
    'وصلت إلى الحد الأعلى للأدوار المخصصة (30).',
    'Custom role limit (30) reached.',
  ],
  team_invite_not_needed: [
    'دخل هذا الشخص بحسابه بالفعل، فلا حاجة لدعوة.',
    'This person has already signed in; no invitation needed.',
  ],
  team_invite_too_soon: [
    'أُرسلت له دعوة قبل قليل. انتظر 10 دقائق قبل إعادة الإرسال، أو أرسل الرابط عبر واتساب.',
    'An invitation was sent moments ago. Wait 10 minutes to resend, or share the link on WhatsApp.',
  ],
  forbidden: ['لا تملك صلاحية هذا الإجراء.', 'You cannot do this.'],
  rate_limited: ['محاولات كثيرة، انتظر دقيقة.', 'Too many attempts; wait a minute.'],
};

function errorText(error: unknown, ar: boolean): string {
  const code = error instanceof ApiError ? error.code : '';
  const known = ERRORS[code];
  if (known) return ar ? known[0] : known[1];
  if (error instanceof ApiError && error.status === 0) return error.message;
  return ar ? 'تعذر حفظ التغيير. أعد المحاولة.' : 'Could not save. Try again.';
}

function TeamFace({
  name,
  mark,
  ar,
}: {
  name: string;
  mark: IdentityMark | undefined;
  ar: boolean;
}) {
  if (mark?.avatarUrl)
    return (
      <IdentityAvatar
        name={name}
        mark={mark}
        locale={ar ? 'ar' : 'en'}
        size={40}
        className="team-member__initial"
      />
    );
  return (
    <span className="team-member__initial" aria-hidden="true">
      {name.trim().slice(0, 1) || '•'}
    </span>
  );
}

function capabilityLabel(id: string, ar: boolean): string {
  const capability = TEAM_CAPABILITIES.find((item) => item.id === id);
  return capability ? (ar ? capability.ar : capability.en) : id;
}

/** Capabilities that come with any of the given roles. */
function includedBy(view: TeamView, roles: readonly string[]): Set<string> {
  return new Set(roles.flatMap((role) => view.roleCapabilities[role] ?? []));
}

function statusInfo(
  status: 'active' | 'inactive',
  signedIn: boolean,
  ar: boolean,
): { text: string; className: string } {
  if (status !== 'active') return { text: ar ? 'معطّل' : 'Disabled', className: 'is-off' };
  if (signedIn) return { text: ar ? 'نشط' : 'Active', className: 'is-on' };
  return { text: ar ? 'بانتظار أول دخول' : 'Awaiting first sign-in', className: 'is-pending' };
}

function useMutation(ar: boolean) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: object) => {
    setBusy(true);
    setError(null);
    try {
      return await browserNextMutation<Record<string, unknown>>(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (caught) {
      setError(errorText(caught, ar));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function CapabilityPicker({
  ar,
  view,
  included,
  selected,
  onChange,
  legend,
}: {
  ar: boolean;
  view: TeamView;
  included: ReadonlySet<string>;
  selected: string[];
  onChange: (next: string[]) => void;
  legend: string;
}) {
  const grantable = new Set(view.grantableCapabilities);
  return (
    <div className="team-caps-groups">
      <p className="team-caps-groups__legend">{legend}</p>
      {CAPABILITY_GROUPS.map((group) => {
        const open = group.capabilities.filter(
          (capability) => grantable.has(capability.id) && !included.has(capability.id),
        );
        const allOn =
          open.length > 0 && open.every((capability) => selected.includes(capability.id));
        return (
          <fieldset key={group.id} className="team-caps">
            <legend>{ar ? group.ar : group.en}</legend>
            {open.length > 1 ? (
              <button
                type="button"
                className="team-caps__all"
                onClick={() =>
                  onChange(
                    allOn
                      ? selected.filter((id) => !open.some((capability) => capability.id === id))
                      : [...new Set([...selected, ...open.map((capability) => capability.id)])],
                  )
                }
              >
                {allOn ? (ar ? 'إلغاء الكل' : 'Clear all') : ar ? 'تحديد الكل' : 'Select all'}
              </button>
            ) : null}
            {group.capabilities.map((capability) => {
              const inRole = included.has(capability.id);
              const allowed = grantable.has(capability.id);
              return (
                <label
                  key={capability.id}
                  className={
                    inRole ? 'team-cap is-included' : allowed ? 'team-cap' : 'team-cap is-locked'
                  }
                >
                  <input
                    type="checkbox"
                    checked={inRole || selected.includes(capability.id)}
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
      })}
    </div>
  );
}

/** Built-in and saved roles as toggles; a member may hold several. */
function RolePicker({
  ar,
  view,
  selected,
  held = [],
  onChange,
}: {
  ar: boolean;
  view: TeamView;
  selected: string[];
  /** Roles the member already holds; kept even when the actor could not give them. */
  held?: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const assignable = new Set<string>(view.assignableRoles);
  const savedAssignable = new Set(view.assignableSavedRoles.map(savedRoleKey));
  const toggle = (role: string, on: boolean) =>
    onChange(on ? [...selected, role] : selected.filter((item) => item !== role));
  const option = (role: string, label: string, hint: string | null, allowed: boolean) => (
    <label key={role} className={allowed ? 'team-role-option' : 'team-role-option is-locked'}>
      <input
        type="checkbox"
        checked={selected.includes(role)}
        disabled={!allowed}
        onChange={(event) => toggle(role, event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
  return (
    <fieldset className="team-roles">
      <legend>{ar ? 'الأدوار (يمكن اختيار أكثر من دور)' : 'Roles (choose one or more)'}</legend>
      {ROLE_GROUPS.map((group) => {
        const roles = group.roles.filter((role) => assignable.has(role) || held.includes(role));
        if (!roles.length) return null;
        return (
          <div key={group.id} className="team-roles__group">
            <span className="team-roles__title">{ar ? group.ar : group.en}</span>
            {roles.map((role) => {
              const label = ROLE_LABELS[role]!;
              return option(
                role,
                ar ? label.ar : label.en,
                ar ? label.hintAr : label.hintEn,
                assignable.has(role),
              );
            })}
          </div>
        );
      })}
      {view.savedRoles.length ? (
        <div className="team-roles__group">
          <span className="team-roles__title">{ar ? 'أدوار مخصصة' : 'Custom roles'}</span>
          {view.savedRoles
            .filter(
              (role) =>
                savedAssignable.has(savedRoleKey(role.id)) || held.includes(savedRoleKey(role.id)),
            )
            .map((role) =>
              option(
                savedRoleKey(role.id),
                ar ? role.nameAr : role.nameEn || role.nameAr,
                role.description,
                savedAssignable.has(savedRoleKey(role.id)),
              ),
            )}
        </div>
      ) : null}
    </fieldset>
  );
}

function RoleChips({ ar, roles, view }: { ar: boolean; roles: readonly string[]; view: TeamView }) {
  return (
    <span className="team-role-chips">
      {roles.map((role) => (
        <span
          key={role}
          className={`team-role team-role--${isCustomRoleKey(role) ? 'custom' : role}`}
        >
          {roleLabel(role, ar, view.savedRoles)}
        </span>
      ))}
    </span>
  );
}

function AddMemberForm({
  ar,
  view,
  onDone,
  onCancel,
}: {
  ar: boolean;
  view: TeamView;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const { busy, error, setError, run } = useMutation(ar);
  const full = view.seats.used >= view.seats.limit;
  const included = includedBy(view, roles);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validTeamEmail(email)) return setError(ERRORS.team_email_invalid![ar ? 0 : 1]);
    if (!roles.length) return setError(ERRORS.team_roles_required![ar ? 0 : 1]);
    const result = await run('/api/owner/team', 'POST', {
      email: email.trim(),
      ...(name.trim() ? { displayName: name.trim() } : {}),
      roles,
      capabilities: extras.filter((id) => !included.has(id)),
    });
    if (!result) return;
    setEmail('');
    setName('');
    setRoles([]);
    setExtras([]);
    onDone(
      ar
        ? result.existingAccount
          ? 'أُضيف العضو. سيجد الفريق في قائمة حسابه عند دخوله.'
          : 'أُضيف العضو وتُرسل له دعوة بالبريد الآن؛ تظهر حالتها تحت اسمه. ينضم عند أول دخول بحساب BHD بنفس البريد.'
        : result.existingAccount
          ? 'Member added. They will find the team in their account menu.'
          : 'Member added; an invitation email is on its way (status shows under their name). They join on first BHD sign-in with that email.',
    );
  };

  return (
    <form className="team-card team-add" onSubmit={(event) => void submit(event)}>
      <h2>{ar ? 'إضافة عضو للفريق' : 'Add a team member'}</h2>
      <p className="team-muted">
        {ar
          ? 'أدخل البريد الذي يستخدمه في حساب BHD، واختر دوراً أو أكثر، ثم أضف ما تريد من صلاحيات منفصلة.'
          : 'Use the email of their BHD account, choose one or more roles, then add any separate permissions.'}
      </p>
      <p className="team-muted team-hint">
        {ar
          ? 'مهم: يُربط العضو بحسابه فقط إذا كان هذا هو البريد المؤكَّد في حسابه على BHD. إن كان يعمل في منشأة أخرى فلا مشكلة: يبقى حساب واحد ويبدّل بين المنشآت من قائمة حسابه، ولا تختلط البيانات.'
          : 'Important: the member is linked only if this is the verified email of their BHD account. Working for another organization is fine: one account, switching organizations from the account menu, with data kept separate.'}
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
      </div>
      <RolePicker ar={ar} view={view} selected={roles} onChange={setRoles} />
      <CapabilityPicker
        ar={ar}
        view={view}
        included={included}
        selected={extras}
        onChange={setExtras}
        legend={
          ar
            ? 'صلاحيات إضافية منفصلة (مثلاً: بعض صلاحيات المحاسب دون الدور كاملاً)'
            : 'Separate extra permissions (for example some accountant powers without the full role)'
        }
      />
      {error ? <p className="team-error">{error}</p> : null}
      <div className="team-actions">
        <button className="button button--primary" type="submit" disabled={busy || full}>
          {busy ? (ar ? 'جارٍ الإضافة…' : 'Adding…') : ar ? 'إضافة للفريق' : 'Add to team'}
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>
          {ar ? 'إلغاء' : 'Cancel'}
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

/** Invitation status and ways to reach someone who has not signed in yet. */
function InvitePanel({
  ar,
  person,
  view,
  onChanged,
}: {
  ar: boolean;
  person: { userId: string; email: string; status: 'active' | 'inactive'; signedIn: boolean };
  view: TeamView;
  onChanged: (message: string) => void;
}) {
  const { busy, error, run } = useMutation(ar);
  const [copied, setCopied] = useState(false);
  if (!view.canManage || !view.inviteUrl || person.signedIn || person.status !== 'active') {
    return null;
  }
  const invite = view.invites[person.userId];
  const when = invite
    ? new Date(invite.at).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
  const line = !invite
    ? ar
      ? 'لم تُرسل له دعوة بالبريد.'
      : 'No invitation email was sent.'
    : invite.state === 'sent'
      ? ar
        ? `أُرسلت الدعوة إلى بريده ${when}.`
        : `Invitation emailed ${when}.`
      : invite.state === 'sending'
        ? ar
          ? 'الدعوة قيد الإرسال إلى بريده.'
          : 'The invitation email is on its way.'
        : ar
          ? 'تعذّر إرسال الدعوة بالبريد. أعد الإرسال أو أرسل له الرابط مباشرة.'
          : 'The invitation email could not be sent. Resend it or share the link directly.';
  const message = ar
    ? `دعوة للانضمام إلى فريق «${view.organizationName}» على BHD R.\nادخل بحساب BHD المسجّل بالبريد ${person.email}:\n${view.inviteUrl}`
    : `You are invited to the “${view.organizationName}” team on BHD R.\nSign in with the BHD account that uses ${person.email}:\n${view.inviteUrl}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };
  const resend = async () => {
    const path = `/api/owner/team/${encodeURIComponent(person.userId)}/invite`;
    if (await run(path, 'POST')) {
      onChanged(ar ? 'أُعيد إرسال الدعوة إلى بريده.' : 'Invitation email sent again.');
    }
  };
  return (
    <div className={`team-invite team-invite--${invite?.state ?? 'none'}`}>
      <p className="team-invite__line">{line}</p>
      <div className="team-actions">
        <button type="button" className="ops-action" disabled={busy} onClick={() => void resend()}>
          {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إعادة إرسال الدعوة' : 'Resend invite'}
        </button>
        <button type="button" className="ops-action" onClick={() => void copy()}>
          {copied ? (ar ? 'نُسخت الدعوة' : 'Copied') : ar ? 'نسخ نص الدعوة' : 'Copy invite'}
        </button>
        <a
          className="ops-action"
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {ar ? 'إرسال عبر واتساب' : 'Send on WhatsApp'}
        </a>
      </div>
      {error ? <p className="team-error">{error}</p> : null}
    </div>
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
  const [roles, setRoles] = useState(member.roles);
  const [extras, setExtras] = useState(member.extras);
  const { busy, error, run } = useMutation(ar);
  const owner = member.roles.includes('organization_owner');
  const manageable =
    view.canManage &&
    !owner &&
    !member.isSelf &&
    member.roles
      .filter((role) => !isCustomRoleKey(role))
      .every((role) => (view.assignableRoles as string[]).includes(role));
  const memberIncluded = includedBy(view, member.roles);
  const extraIds = member.extras.filter((id) => !memberIncluded.has(id));
  const included = includedBy(view, roles);
  const status = statusInfo(member.status, member.signedIn, ar);
  const path = `/api/owner/team/${encodeURIComponent(member.userId)}`;

  const send = async (method: 'PATCH' | 'DELETE', body: object | undefined, done: string) => {
    if (await run(path, method, body)) {
      setEditing(false);
      onChanged(done);
    }
  };

  return (
    <li className={member.status === 'active' ? 'team-member' : 'team-member is-inactive'}>
      <div className="team-member__head">
        <TeamFace name={member.displayName} mark={view.marks?.[member.userId]} ar={ar} />
        <div className="team-member__who">
          <strong className="name-with-mark">
            {member.displayName}
            <VerifiedMark
              verified={view.marks?.[member.userId]?.verified}
              locale={ar ? 'ar' : 'en'}
            />
            <BadgeChips
              badges={view.badges?.[badgeSubjectKey('staff', member.userId)]}
              locale={ar ? 'ar' : 'en'}
              size={18}
            />
            {member.isSelf ? <em>{ar ? ' (أنت)' : ' (you)'}</em> : null}
          </strong>
          <small dir="ltr">{member.email}</small>
        </div>
        <RoleChips ar={ar} roles={member.roles} view={view} />
        <span className={`team-status ${status.className}`}>{status.text}</span>
      </div>
      {extraIds.length > 0 ? (
        <div className="team-member__extras">
          <span>{ar ? 'إضافية:' : 'Extra:'}</span>
          {extraIds.map((id) => (
            <i key={id}>{capabilityLabel(id, ar)}</i>
          ))}
        </div>
      ) : null}
      {!owner && !member.isSelf ? (
        <InvitePanel ar={ar} person={member} view={view} onChanged={onChanged} />
      ) : null}
      {manageable && !editing ? (
        <div className="team-actions">
          <button
            type="button"
            className="ops-action"
            disabled={busy}
            onClick={() => {
              setRoles(member.roles);
              setExtras(member.extras);
              setEditing(true);
            }}
          >
            {ar ? 'تعديل الأدوار والصلاحيات' : 'Edit roles & access'}
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
              if (ok)
                void send('DELETE', undefined, ar ? 'أُزيل العضو من الفريق.' : 'Member removed.');
            }}
          >
            {ar ? 'إزالة' : 'Remove'}
          </button>
        </div>
      ) : null}
      {editing ? (
        <div className="team-edit">
          <RolePicker
            ar={ar}
            view={view}
            selected={roles}
            held={member.roles}
            onChange={setRoles}
          />
          <CapabilityPicker
            ar={ar}
            view={view}
            included={included}
            selected={extras}
            onChange={setExtras}
            legend={ar ? 'صلاحيات إضافية منفصلة' : 'Separate extra permissions'}
          />
          <div className="team-actions">
            <button
              type="button"
              className="button button--primary button--tiny"
              disabled={busy || !roles.length}
              onClick={() =>
                void send(
                  'PATCH',
                  { roles, capabilities: extras.filter((id) => !included.has(id)) },
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

function OwnerRow({
  ar,
  owner,
  view,
  onChanged,
}: {
  ar: boolean;
  owner: PropertyOwnerMember;
  view: TeamView;
  onChanged: (message: string) => void;
}) {
  const { busy, error, run } = useMutation(ar);
  const status = statusInfo(owner.status, owner.signedIn, ar);
  const path = `/api/owner/team/owners/${encodeURIComponent(owner.userId)}`;
  const send = async (method: 'PATCH' | 'DELETE', body: object | undefined, done: string) => {
    if (await run(path, method, body)) onChanged(done);
  };
  return (
    <li className={owner.status === 'active' ? 'team-member' : 'team-member is-inactive'}>
      <div className="team-member__head">
        <TeamFace name={owner.displayName} mark={view.marks?.[owner.userId]} ar={ar} />
        <div className="team-member__who">
          <strong className="name-with-mark">
            {owner.displayName}
            <VerifiedMark
              verified={view.marks?.[owner.userId]?.verified}
              locale={ar ? 'ar' : 'en'}
            />
            {owner.partyId ? (
              <BadgeChips
                badges={view.badges?.[badgeSubjectKey('owner', owner.partyId)]}
                locale={ar ? 'ar' : 'en'}
                size={18}
              />
            ) : null}
          </strong>
          <small dir="ltr">{owner.email}</small>
        </div>
        <span className="team-role team-role--property_owner">
          {owner.partyName ?? (ar ? 'مالك غير محدد' : 'Owner not set')}
        </span>
        <span className="team-role">
          {ar ? `${owner.propertyCount} عقار` : `${owner.propertyCount} properties`}
        </span>
        <span className={`team-status ${status.className}`}>{status.text}</span>
      </div>
      <InvitePanel ar={ar} person={owner} view={view} onChanged={onChanged} />
      {view.canManage ? (
        <div className="team-actions">
          {view.ownerParties.length > 1 ? (
            <label className="team-field team-field--inline">
              <span>{ar ? 'يرى عقارات' : 'Sees properties of'}</span>
              <select
                value={owner.partyId ?? ''}
                disabled={busy}
                onChange={(event) =>
                  void send(
                    'PATCH',
                    { partyId: event.target.value },
                    ar ? 'تغيّر المالك المرتبط بالحساب.' : 'Linked owner changed.',
                  )
                }
              >
                {view.ownerParties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name} ({party.propertyCount})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="ops-action"
            disabled={busy}
            onClick={() =>
              void send(
                'PATCH',
                { status: owner.status === 'active' ? 'inactive' : 'active' },
                owner.status === 'active'
                  ? ar
                    ? 'أُوقف دخول المالك.'
                    : 'Owner access paused.'
                  : ar
                    ? 'أُعيد دخول المالك.'
                    : 'Owner access restored.',
              )
            }
          >
            {owner.status === 'active' ? (ar ? 'تعطيل' : 'Disable') : ar ? 'تفعيل' : 'Reactivate'}
          </button>
          <button
            type="button"
            className="ops-action ops-action--danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  ar
                    ? `إنهاء دخول ${owner.displayName} إلى بوابة المالك؟`
                    : `End ${owner.displayName}'s owner portal access?`,
                )
              )
                void send('DELETE', undefined, ar ? 'أُنهي دخول المالك.' : 'Owner access ended.');
            }}
          >
            {ar ? 'إزالة' : 'Remove'}
          </button>
        </div>
      ) : null}
      {error ? <p className="team-error">{error}</p> : null}
    </li>
  );
}

function AddOwnerForm({
  ar,
  view,
  onDone,
  onCancel,
}: {
  ar: boolean;
  view: TeamView;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [partyId, setPartyId] = useState(view.ownerParties[0]?.id ?? '');
  const { busy, error, setError, run } = useMutation(ar);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validTeamEmail(email)) return setError(ERRORS.team_email_invalid![ar ? 0 : 1]);
    if (!partyId) return setError(ERRORS.team_owner_party_required![ar ? 0 : 1]);
    const result = await run('/api/owner/team/owners', 'POST', {
      email: email.trim(),
      partyId,
      ...(name.trim() ? { displayName: name.trim() } : {}),
    });
    if (!result) return;
    setEmail('');
    setName('');
    onDone(
      ar
        ? 'أُضيف مالك العقار وتُرسل له دعوة بالبريد. يدخل بحساب BHD المؤكَّد بنفس البريد فيرى عقاراته فقط.'
        : 'Property owner added; an invitation email is on its way. They sign in with the BHD account verified on that email and see only their properties.',
    );
  };

  if (!view.ownerParties.length) {
    return (
      <p className="team-card team-muted">
        {ar
          ? 'لا يوجد ملاك عقارات مسجلون بعد. حدّد مالك العقار من صفحة العقار ← المالك، ثم عد إلى هنا لمنحه الدخول.'
          : 'No property owners are registered yet. Set the owner on the property page, then come back to give them access.'}
      </p>
    );
  }
  return (
    <form className="team-card team-add" onSubmit={(event) => void submit(event)}>
      <h2>{ar ? 'منح مالك عقار دخولاً' : 'Give a property owner access'}</h2>
      <p className="team-muted">
        {ar
          ? 'يرى المالك عقاراته فقط: حجوزاتها وعقودها وفواتيرها وصيانتها، ولا يرى عقارات غيره أو بيانات المنشأة. لا يُحتسب ضمن مقاعد الفريق.'
          : 'The owner sees only their own properties (bookings, contracts, invoices, maintenance), nothing else. Does not use a team seat.'}
      </p>
      <div className="team-add__grid">
        <label className="team-field">
          <span>{ar ? 'المالك' : 'Owner'}</span>
          <select value={partyId} onChange={(event) => setPartyId(event.target.value)}>
            {view.ownerParties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name} —{' '}
                {ar ? `${party.propertyCount} عقار` : `${party.propertyCount} properties`}
              </option>
            ))}
          </select>
        </label>
        <label className="team-field">
          <span>{ar ? 'بريده في حساب BHD' : 'Their BHD account email'}</span>
          <input
            type="email"
            dir="ltr"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="owner@example.com"
          />
        </label>
        <label className="team-field">
          <span>{ar ? 'الاسم (اختياري)' : 'Name (optional)'}</span>
          <input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
        </label>
      </div>
      {error ? <p className="team-error">{error}</p> : null}
      <div className="team-actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? (ar ? 'جارٍ الإضافة…' : 'Adding…') : ar ? 'منح الدخول' : 'Give access'}
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

function LawyerRow({
  ar,
  lawyer,
  view,
  onChanged,
}: {
  ar: boolean;
  lawyer: LawyerMember;
  view: TeamView;
  onChanged: (message: string) => void;
}) {
  const { busy, error, run } = useMutation(ar);
  const status = statusInfo(lawyer.status, lawyer.signedIn, ar);
  const path = `/api/owner/team/lawyers/${encodeURIComponent(lawyer.userId)}`;
  const send = async (method: 'PATCH' | 'DELETE', body: object | undefined, done: string) => {
    if (await run(path, method, body)) onChanged(done);
  };
  return (
    <li className={lawyer.status === 'active' ? 'team-member' : 'team-member is-inactive'}>
      <div className="team-member__head">
        <TeamFace name={lawyer.displayName} mark={view.marks?.[lawyer.userId]} ar={ar} />
        <div className="team-member__who">
          <strong className="name-with-mark">
            {lawyer.displayName}
            <VerifiedMark
              verified={view.marks?.[lawyer.userId]?.verified}
              locale={ar ? 'ar' : 'en'}
            />
          </strong>
          <small dir="ltr">{lawyer.email}</small>
        </div>
        <span className="team-role team-role--lawyer">
          {lawyer.partyName ?? (ar ? 'محامٍ' : 'Lawyer')}
        </span>
        <span className="team-role">
          {ar ? `${lawyer.caseCount} قضية` : `${lawyer.caseCount} cases`}
        </span>
        <span className={`team-status ${status.className}`}>{status.text}</span>
      </div>
      <InvitePanel ar={ar} person={lawyer} view={view} onChanged={onChanged} />
      {view.canManage ? (
        <div className="team-actions">
          {view.lawyerParties.length > 1 ? (
            <label className="team-field team-field--inline">
              <span>{ar ? 'يتبع' : 'Works for'}</span>
              <select
                value={lawyer.partyId ?? ''}
                disabled={busy}
                onChange={(event) =>
                  void send(
                    'PATCH',
                    { partyId: event.target.value },
                    ar ? 'تغيّر المكتب المرتبط بالمحامي.' : 'Linked firm changed.',
                  )
                }
              >
                {view.lawyerParties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name} ({party.caseCount})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="ops-action"
            disabled={busy}
            onClick={() =>
              void send(
                'PATCH',
                { status: lawyer.status === 'active' ? 'inactive' : 'active' },
                lawyer.status === 'active'
                  ? ar
                    ? 'أُوقف دخول المحامي.'
                    : 'Lawyer access paused.'
                  : ar
                    ? 'أُعيد دخول المحامي.'
                    : 'Lawyer access restored.',
              )
            }
          >
            {lawyer.status === 'active' ? (ar ? 'تعطيل' : 'Disable') : ar ? 'تفعيل' : 'Reactivate'}
          </button>
          <button
            type="button"
            className="ops-action ops-action--danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  ar
                    ? `إنهاء دخول ${lawyer.displayName}؟ تبقى القضايا ومراسلاتها لدى المنشأة.`
                    : `End ${lawyer.displayName}'s access? Cases and messages stay with you.`,
                )
              )
                void send('DELETE', undefined, ar ? 'أُنهي دخول المحامي.' : 'Lawyer access ended.');
            }}
          >
            {ar ? 'إزالة' : 'Remove'}
          </button>
        </div>
      ) : null}
      {error ? <p className="team-error">{error}</p> : null}
    </li>
  );
}

function AddLawyerForm({
  ar,
  view,
  onDone,
  onCancel,
}: {
  ar: boolean;
  view: TeamView;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [firm, setFirm] = useState('');
  const [partyId, setPartyId] = useState('');
  const { busy, error, setError, run } = useMutation(ar);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validTeamEmail(email)) return setError(ERRORS.team_email_invalid![ar ? 0 : 1]);
    const result = await run('/api/owner/team/lawyers', 'POST', {
      email: email.trim(),
      ...(name.trim() ? { displayName: name.trim() } : {}),
      ...(partyId ? { partyId } : firm.trim() ? { firmName: firm.trim() } : {}),
    });
    if (!result) return;
    setEmail('');
    setName('');
    setFirm('');
    setPartyId('');
    onDone(
      ar
        ? 'أُضيف المحامي وتُرسل له دعوة بالبريد. يدخل بحساب BHD المؤكَّد بنفس البريد فيرى القضايا المسندة إليه فقط. أسند إليه القضايا من صفحة كل قضية.'
        : 'Lawyer added; an invitation email is on its way. They sign in with the BHD account verified on that email and see only the cases assigned to them. Assign cases from each case page.',
    );
  };

  return (
    <form className="team-card team-add" onSubmit={(event) => void submit(event)}>
      <h2>{ar ? 'إضافة محامٍ' : 'Add a lawyer'}</h2>
      <p className="team-muted">
        {ar
          ? 'يرى المحامي القضايا المسندة إليه فقط مع بيانات العقار والعقد والخصم المرتبطة بها، ويحدّث المراحل والجلسات والمبالغ ويراسل فريقك. لا يرى أي شيء آخر ولا يُحتسب ضمن مقاعد الفريق.'
          : 'The lawyer sees only the cases assigned to them, with the related property, lease and counterparty, updates stages, hearings and amounts, and messages your team. Nothing else; no team seat.'}
      </p>
      <div className="team-add__grid">
        <label className="team-field">
          <span>{ar ? 'بريده في حساب BHD' : 'Their BHD account email'}</span>
          <input
            type="email"
            dir="ltr"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="lawyer@example.com"
          />
        </label>
        <label className="team-field">
          <span>{ar ? 'اسم المحامي' : 'Lawyer’s name'}</span>
          <input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
        </label>
        {view.lawyerParties.length ? (
          <label className="team-field">
            <span>{ar ? 'يتبع مكتباً مسجلاً؟' : 'Works for a listed firm?'}</span>
            <select value={partyId} onChange={(event) => setPartyId(event.target.value)}>
              <option value="">
                {ar ? 'لا — محامٍ أو مكتب جديد' : 'No — a new lawyer or firm'}
              </option>
              {view.lawyerParties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name} — {ar ? `${party.caseCount} قضية` : `${party.caseCount} cases`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!partyId ? (
          <label className="team-field">
            <span>{ar ? 'اسم مكتب المحاماة (اختياري)' : 'Law firm name (optional)'}</span>
            <input value={firm} maxLength={200} onChange={(event) => setFirm(event.target.value)} />
          </label>
        ) : null}
      </div>
      {error ? <p className="team-error">{error}</p> : null}
      <div className="team-actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? (ar ? 'جارٍ الإضافة…' : 'Adding…') : ar ? 'منح الدخول' : 'Give access'}
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

function TenantRow({
  ar,
  tenant,
  mark,
  canManage,
  onChanged,
}: {
  ar: boolean;
  tenant: TenantMember;
  mark: IdentityMark | undefined;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { busy, error, run } = useMutation(ar);
  const status = statusInfo(tenant.status, tenant.signedIn, ar);
  const toggle = async () => {
    const next = tenant.status === 'active' ? 'inactive' : 'active';
    const done = await run(
      `/api/owner/team/tenants/${encodeURIComponent(tenant.userId)}`,
      'PATCH',
      {
        status: next,
      },
    );
    if (done)
      onChanged(
        next === 'inactive'
          ? ar
            ? 'أُوقف دخول المستأجر.'
            : 'Tenant access paused.'
          : ar
            ? 'أُعيد دخول المستأجر.'
            : 'Tenant access restored.',
      );
  };
  return (
    <li className={tenant.status === 'active' ? 'team-member' : 'team-member is-inactive'}>
      <div className="team-member__head">
        <TeamFace name={tenant.displayName} mark={mark} ar={ar} />
        <div className="team-member__who">
          <strong className="name-with-mark">
            {tenant.displayName}
            <VerifiedMark verified={mark?.verified} locale={ar ? 'ar' : 'en'} />
          </strong>
          <small dir="ltr">{tenant.email}</small>
        </div>
        {tenant.partyName ? <span className="team-role">{tenant.partyName}</span> : null}
        <span className={`team-status ${status.className}`}>{status.text}</span>
        {canManage ? (
          <button
            type="button"
            className="ops-action"
            disabled={busy}
            onClick={() => void toggle()}
          >
            {tenant.status === 'active'
              ? ar
                ? 'تعطيل الدخول'
                : 'Pause access'
              : ar
                ? 'تفعيل'
                : 'Restore'}
          </button>
        ) : null}
      </div>
      {error ? <p className="team-error">{error}</p> : null}
    </li>
  );
}

function TenantsTab({
  ar,
  view,
  onChanged,
}: {
  ar: boolean;
  view: TeamView;
  onChanged: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? view.tenants.filter((tenant) =>
          `${tenant.displayName} ${tenant.email} ${tenant.partyName ?? ''}`
            .toLowerCase()
            .includes(needle),
        )
      : view.tenants;
  }, [query, view.tenants]);
  return (
    <section className="team-card">
      <h2>
        {ar ? 'المستأجرون الذين لديهم دخول' : 'Tenants with portal access'}{' '}
        <small>({view.tenants.length})</small>
      </h2>
      <p className="team-muted">
        {ar
          ? 'يُضاف المستأجر تلقائياً عند توقيعه عقداً أو حجزه. التعطيل يوقف دخوله إلى صفحات المستأجر في منشأتك دون حذف سجلاته.'
          : 'Tenants join automatically when they sign or book. Pausing stops their tenant pages in your organization; their records stay.'}
      </p>
      {view.tenants.length > 8 ? (
        <label className="team-field team-search">
          <span>{ar ? 'بحث' : 'Search'}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      ) : null}
      {shown.length ? (
        <ul className="team-list">
          {shown.map((tenant) => (
            <TenantRow
              key={`${tenant.userId}:${tenant.status}`}
              ar={ar}
              tenant={tenant}
              mark={view.marks?.[tenant.userId]}
              canManage={view.canManage}
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : (
        <p className="team-muted">{ar ? 'لا يوجد مستأجرون بعد.' : 'No tenants yet.'}</p>
      )}
    </section>
  );
}

function SavedRoleEditor({
  ar,
  view,
  role,
  onDone,
  onCancel,
}: {
  ar: boolean;
  view: TeamView;
  role: SavedRole | null;
  onDone: (message: string) => void;
  onCancel?: () => void;
}) {
  const [nameAr, setNameAr] = useState(role?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(role?.nameEn ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [capabilities, setCapabilities] = useState<string[]>(role?.capabilities ?? []);
  const { busy, error, setError, run } = useMutation(ar);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (nameAr.trim().length < 2 || !capabilities.length)
      return setError(ERRORS.team_role_invalid![ar ? 0 : 1]);
    const body = {
      nameAr: nameAr.trim(),
      ...(nameEn.trim() ? { nameEn: nameEn.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      capabilities,
    };
    const done = role
      ? await run(`/api/owner/team/roles/${encodeURIComponent(role.id)}`, 'PATCH', body)
      : await run('/api/owner/team/roles', 'POST', body);
    if (!done) return;
    if (!role) {
      setNameAr('');
      setNameEn('');
      setDescription('');
      setCapabilities([]);
    }
    onDone(
      role
        ? ar
          ? 'حُفظ الدور، وتسري صلاحياته الجديدة على حامليه فوراً.'
          : 'Role saved; holders get the new access right away.'
        : ar
          ? 'أُنشئ الدور. يمكنك منحه من تبويب الفريق.'
          : 'Role created. Give it from the Team tab.',
    );
  };

  return (
    <form
      className={role ? 'team-edit' : 'team-card team-add'}
      onSubmit={(event) => void submit(event)}
    >
      {role ? null : <h2>{ar ? 'إنشاء دور مخصص' : 'Create a custom role'}</h2>}
      {role ? null : (
        <p className="team-muted">
          {ar
            ? 'سمِّ الدور (مثلاً «محاسب استلام» أو «مشرف مبنى») واختر صلاحياته، ثم امنحه لأي عضو. تعديل الدور يسري على كل من يحمله.'
            : 'Name the role (e.g. “Cashier” or “Building supervisor”), pick its permissions, then give it to members. Editing applies to every holder.'}
        </p>
      )}
      <div className="team-add__grid">
        <label className="team-field">
          <span>{ar ? 'اسم الدور بالعربية' : 'Arabic name'}</span>
          <input
            value={nameAr}
            maxLength={80}
            required
            onChange={(event) => setNameAr(event.target.value)}
          />
        </label>
        <label className="team-field">
          <span>{ar ? 'الاسم بالإنجليزية (اختياري)' : 'English name (optional)'}</span>
          <input
            dir="ltr"
            value={nameEn}
            maxLength={80}
            onChange={(event) => setNameEn(event.target.value)}
          />
        </label>
        <label className="team-field">
          <span>{ar ? 'وصف قصير (اختياري)' : 'Short description (optional)'}</span>
          <input
            value={description}
            maxLength={300}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>
      <CapabilityPicker
        ar={ar}
        view={view}
        included={new Set()}
        selected={capabilities}
        onChange={setCapabilities}
        legend={ar ? 'صلاحيات الدور' : 'Role permissions'}
      />
      {error ? <p className="team-error">{error}</p> : null}
      <div className="team-actions">
        <button className="button button--primary button--tiny" type="submit" disabled={busy}>
          {busy
            ? ar
              ? 'جارٍ الحفظ…'
              : 'Saving…'
            : role
              ? ar
                ? 'حفظ'
                : 'Save'
              : ar
                ? 'إنشاء الدور'
                : 'Create role'}
        </button>
        {onCancel ? (
          <button type="button" className="button button--quiet button--tiny" onClick={onCancel}>
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function SavedRoleRow({
  ar,
  role,
  view,
  onChanged,
}: {
  ar: boolean;
  role: SavedRole;
  view: TeamView;
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useMutation(ar);
  const archive = async () => {
    const ok = window.confirm(
      ar
        ? `حذف دور «${role.nameAr}»؟ يفقده ${role.memberCount} عضو فوراً.`
        : `Delete “${role.nameEn || role.nameAr}”? ${role.memberCount} member(s) lose it now.`,
    );
    if (ok && (await run(`/api/owner/team/roles/${encodeURIComponent(role.id)}`, 'DELETE')))
      onChanged(ar ? 'حُذف الدور.' : 'Role deleted.');
  };
  return (
    <li className="team-member">
      <div className="team-member__head">
        <div className="team-member__who">
          <strong>{ar ? role.nameAr : role.nameEn || role.nameAr}</strong>
          {role.description ? <small>{role.description}</small> : null}
        </div>
        <span className="team-role team-role--custom">
          {ar ? `${role.memberCount} عضو` : `${role.memberCount} member(s)`}
        </span>
      </div>
      <div className="team-member__extras">
        {role.capabilities.map((id) => (
          <i key={id}>{capabilityLabel(id, ar)}</i>
        ))}
      </div>
      {view.canEditRoles && !editing ? (
        <div className="team-actions">
          <button
            type="button"
            className="ops-action"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            {ar ? 'تعديل' : 'Edit'}
          </button>
          <button
            type="button"
            className="ops-action ops-action--danger"
            disabled={busy}
            onClick={() => void archive()}
          >
            {ar ? 'حذف' : 'Delete'}
          </button>
        </div>
      ) : null}
      {editing ? (
        <SavedRoleEditor
          ar={ar}
          view={view}
          role={role}
          onDone={(message) => {
            setEditing(false);
            onChanged(message);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      {error ? <p className="team-error">{error}</p> : null}
    </li>
  );
}

function RolesGuide({ ar }: { ar: boolean }) {
  const extra = ['organization_owner', 'property_owner', 'lawyer'] as const;
  return (
    <section className="team-card team-guide">
      {ROLE_GROUPS.map((group) => (
        <div key={group.id}>
          <h3>{ar ? group.ar : group.en}</h3>
          <dl>
            {group.roles.map((role) => {
              const label = ROLE_LABELS[role]!;
              return (
                <div key={role}>
                  <dt>{ar ? label.ar : label.en}</dt>
                  <dd>{ar ? label.hintAr : label.hintEn}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
      <h3>
        {ar
          ? 'المالك وملاك العقارات والمحامون والمستأجرون'
          : 'Owner, property owners, lawyers and tenants'}
      </h3>
      <dl>
        {extra.map((role) => {
          const label = ROLE_LABELS[role]!;
          return (
            <div key={role}>
              <dt>{ar ? label.ar : label.en}</dt>
              <dd>{ar ? label.hintAr : label.hintEn}</dd>
            </div>
          );
        })}
        <div>
          <dt>{ar ? 'مستأجر' : 'Tenant'}</dt>
          <dd>
            {ar
              ? 'يرى عقوده وحجوزاته وفواتيره وطلبات صيانته في بوابة المستأجر.'
              : 'Sees their own contracts, bookings, invoices and maintenance requests.'}
          </dd>
        </div>
      </dl>
      <p className="team-muted">
        {ar
          ? 'يمكن منح العضو أكثر من دور، أو دوراً مخصصاً، أو صلاحيات منفصلة مثل «عرض الفواتير» و«تسجيل المدفوعات» دون دور المحاسب كاملاً. تحويل التأمين يتم من «الحسابات» بيد من يملك صلاحية التحويل.'
          : 'A member can hold several roles, a custom role, or separate permissions such as “see invoices” and “record payments” without the full accountant role. Deposit transfers happen in Accounting by whoever holds that permission.'}
      </p>
    </section>
  );
}

type Tab = 'staff' | 'owners' | 'lawyers' | 'tenants' | 'roles' | 'guide';

/** Owner/admin team: staff, building owners, tenants and custom roles, each with their access. */
export function TeamManager({ locale, active }: { locale: 'ar' | 'en'; active: boolean }) {
  const ar = locale === 'ar';
  const [view, setView] = useState<TeamView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('staff');
  const [adding, setAdding] = useState(false);

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

  const tabs: { id: Tab; label: string; count?: number }[] = view
    ? [
        { id: 'staff', label: ar ? 'الفريق' : 'Team', count: view.members.length },
        {
          id: 'owners',
          label: ar ? 'ملاك العقارات' : 'Property owners',
          count: view.owners.length,
        },
        { id: 'lawyers', label: ar ? 'المحامون' : 'Lawyers', count: view.lawyers.length },
        { id: 'tenants', label: ar ? 'المستأجرون' : 'Tenants', count: view.tenants.length },
        {
          id: 'roles',
          label: ar ? 'الأدوار المخصصة' : 'Custom roles',
          count: view.savedRoles.length,
        },
        { id: 'guide', label: ar ? 'دليل الأدوار' : 'Roles guide' },
      ]
    : [];

  const added = (message: string) => {
    setAdding(false);
    changed(message);
  };
  const addButton = (label: string) => (
    <button
      type="button"
      className="button button--primary team-add-toggle"
      onClick={() => {
        setAdding(true);
        setNotice(null);
      }}
    >
      ＋ {label}
    </button>
  );

  let body: ReactNode = null;
  if (view && tab === 'staff') {
    const canAdd =
      view.canManage && (view.assignableRoles.length > 0 || view.assignableSavedRoles.length > 0);
    body = (
      <div className="team-stack">
        {canAdd && adding ? (
          <AddMemberForm ar={ar} view={view} onDone={added} onCancel={() => setAdding(false)} />
        ) : null}
        <section className="team-card">
          <div className="team-card__head">
            <h2>
              {ar ? 'أعضاء الفريق' : 'Team members'} <small>({view.members.length})</small>
            </h2>
            {canAdd && !adding ? addButton(ar ? 'إضافة عضو' : 'Add member') : null}
          </div>
          <ul className="team-list">
            {view.members.map((member) => (
              <MemberRow
                key={`${member.userId}:${member.roles.join(',')}:${member.status}:${member.extras.join(',')}`}
                ar={ar}
                member={member}
                view={view}
                onChanged={changed}
              />
            ))}
          </ul>
        </section>
      </div>
    );
  } else if (view && tab === 'owners') {
    const canAdd = view.canManage && view.ownerParties.length > 0;
    body = (
      <div className="team-stack">
        {canAdd && adding ? (
          <AddOwnerForm ar={ar} view={view} onDone={added} onCancel={() => setAdding(false)} />
        ) : null}
        {view.canManage && !view.ownerParties.length ? (
          <AddOwnerForm ar={ar} view={view} onDone={added} onCancel={() => setAdding(false)} />
        ) : null}
        <section className="team-card">
          <div className="team-card__head">
            <h2>
              {ar ? 'ملاك العقارات' : 'Property owners'} <small>({view.owners.length})</small>
            </h2>
            {canAdd && !adding ? addButton(ar ? 'منح مالك دخولاً' : 'Give an owner access') : null}
          </div>
          <p className="team-muted">
            {ar
              ? 'مالك العقار يرى عقاراته فقط وحجوزاتها وعقودها وفواتيرها وصيانتها من صفحة العقار، ولا يُحتسب ضمن مقاعد الفريق.'
              : 'A property owner sees only their own properties and, from each property page, its bookings, contracts, invoices and maintenance. No team seat.'}
          </p>
          {view.owners.length ? (
            <ul className="team-list">
              {view.owners.map((owner) => (
                <OwnerRow
                  key={`${owner.userId}:${owner.partyId}:${owner.status}`}
                  ar={ar}
                  owner={owner}
                  view={view}
                  onChanged={changed}
                />
              ))}
            </ul>
          ) : (
            <p className="team-muted">
              {ar ? 'لم يُمنح أي مالك عقار دخولاً بعد.' : 'No property owner has access yet.'}
            </p>
          )}
        </section>
      </div>
    );
  } else if (view && tab === 'lawyers') {
    body = (
      <div className="team-stack">
        {view.canManage && adding ? (
          <AddLawyerForm ar={ar} view={view} onDone={added} onCancel={() => setAdding(false)} />
        ) : null}
        <section className="team-card">
          <div className="team-card__head">
            <h2>
              {ar ? 'المحامون ومكاتب المحاماة' : 'Lawyers and law firms'}{' '}
              <small>({view.lawyers.length})</small>
            </h2>
            {view.canManage && !adding ? addButton(ar ? 'إضافة محامٍ' : 'Add a lawyer') : null}
          </div>
          <p className="team-muted">
            {ar
              ? 'المحامي يرى القضايا المسندة إليه فقط في «المحاماة والقضايا»، يحدّثها ويراسل فريقك داخل كل قضية ويصلكم تنبيه وبريد بكل رسالة. لا يُحتسب ضمن مقاعد الفريق.'
              : 'A lawyer sees only the cases assigned to them under Legal cases, updates them and messages your team inside each case, with a bell and email for every message. No team seat.'}
          </p>
          {view.lawyers.length ? (
            <ul className="team-list">
              {view.lawyers.map((lawyer) => (
                <LawyerRow
                  key={`${lawyer.userId}:${lawyer.partyId}:${lawyer.status}`}
                  ar={ar}
                  lawyer={lawyer}
                  view={view}
                  onChanged={changed}
                />
              ))}
            </ul>
          ) : (
            <p className="team-muted">
              {ar ? 'لم يُضف أي محامٍ بعد.' : 'No lawyer has access yet.'}
            </p>
          )}
        </section>
      </div>
    );
  } else if (view && tab === 'tenants') {
    body = <TenantsTab ar={ar} view={view} onChanged={changed} />;
  } else if (view && tab === 'roles') {
    body = (
      <div className="team-stack">
        {view.canEditRoles && adding ? (
          <SavedRoleEditor
            ar={ar}
            view={view}
            role={null}
            onDone={added}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        <section className="team-card">
          <div className="team-card__head">
            <h2>
              {ar ? 'الأدوار المخصصة' : 'Custom roles'} <small>({view.savedRoles.length})</small>
            </h2>
            {view.canEditRoles && !adding ? addButton(ar ? 'إنشاء دور' : 'Create role') : null}
          </div>
          {view.savedRoles.length ? (
            <ul className="team-list">
              {view.savedRoles.map((role) => (
                <SavedRoleRow key={role.id} ar={ar} role={role} view={view} onChanged={changed} />
              ))}
            </ul>
          ) : (
            <p className="team-muted">
              {ar
                ? 'لا أدوار مخصصة بعد. أنشئ دوراً بصلاحيات تختارها ثم امنحه لأعضاء الفريق.'
                : 'No custom roles yet. Create one with the permissions you choose, then give it to members.'}
            </p>
          )}
          {view.canEditRoles ? null : (
            <p className="team-muted">
              {ar
                ? 'إنشاء الأدوار المخصصة وتعديلها للمالك فقط.'
                : 'Only the owner creates and edits custom roles.'}
            </p>
          )}
        </section>
      </div>
    );
  } else if (view && tab === 'guide') {
    body = <RolesGuide ar={ar} />;
  }

  return (
    <div className="team-page">
      <header className="portal-topbar">
        <div>
          <h1>{ar ? 'الفريق والصلاحيات' : 'Team & access'}</h1>
          <p>
            {ar
              ? 'مديرون ومحاسبون ومدققون وقانونيون وموظفون إداريون وفنيون وحراس مبانٍ، وملاك العقارات والمستأجرون، ولكل منهم صلاحياته.'
              : 'Managers, accountants, auditors, legal, office staff, technicians and guards, plus property owners and tenants, each with their own access.'}
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

      {view ? (
        <div
          className="team-tabs"
          role="tablist"
          aria-label={ar ? 'أقسام الفريق' : 'Team sections'}
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'team-tab is-active' : 'team-tab'}
              onClick={() => {
                setTab(item.id);
                setAdding(false);
                setNotice(null);
              }}
            >
              {item.label}
              {item.count !== undefined ? <small>{item.count}</small> : null}
            </button>
          ))}
        </div>
      ) : null}

      {notice ? (
        <p className="team-notice" role="status">
          {notice}
        </p>
      ) : null}

      {failed === 'forbidden' ? (
        <p className="team-card team-muted">
          {ar
            ? 'إدارة الفريق متاحة للمالك والمدير العام فقط.'
            : 'Team management is for the owner and general managers.'}
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
        body
      )}
    </div>
  );
}
