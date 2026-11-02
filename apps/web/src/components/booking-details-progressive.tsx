'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { InternationalPhoneField } from '@/components/international-phone-field';
import type { BookingContactsForViewer, BookingFor } from '@/lib/booking-contacts-neon';
import { isInternationalPhone } from '@/lib/world-countries';

type DetailStep = {
  id: string;
  label: string;
  done: boolean;
  focusId?: string;
  body: ReactNode;
};

const NEW_CONTACT = 'new';

function focusStepField(id: string | undefined) {
  if (!id || typeof document === 'undefined') return;
  window.requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLElement)) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function emailOk(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Progressive «Your details» for lease/sale booking — one field at a time,
 * matching the contract-party form pattern.
 */
export function BookingDetailsProgressive({
  locale,
  bookingFor,
  onBookingFor,
  entityType,
  onEntityType,
  contacts,
  savedContactId,
  onSavedContact,
  fullName,
  phone,
  email,
  onFormChange,
  offerSave,
  saveContact,
  onSaveContact,
}: {
  locale: 'ar' | 'en';
  bookingFor: BookingFor;
  onBookingFor: (next: BookingFor) => void;
  entityType: 'person' | 'company';
  onEntityType: (next: 'person' | 'company') => void;
  contacts: BookingContactsForViewer;
  savedContactId: string;
  onSavedContact: (id: string) => void;
  fullName: string;
  phone: string;
  email: string;
  onFormChange: (patch: { fullName?: string; phone?: string; email?: string }) => void;
  offerSave: boolean;
  saveContact: boolean;
  onSaveContact: (next: boolean) => void;
}) {
  const ar = locale === 'ar';
  const [bookingForPicked, setBookingForPicked] = useState(false);
  const [entityPicked, setEntityPicked] = useState(false);
  const [unlocked, setUnlocked] = useState(0);
  const [viewIndex, setViewIndex] = useState(0);
  const lastFocused = useRef<string | null>(null);

  const forCompany = bookingFor === 'other' && entityType === 'company';
  const pathReady = bookingForPicked && (bookingFor === 'self' || entityPicked);
  const showSaved =
    pathReady && bookingFor === 'other' && entityType === 'person' && contacts.saved.length > 0;
  const showSave =
    pathReady &&
    offerSave &&
    !(bookingFor === 'other' && entityType === 'company') &&
    fullName.trim().length >= 2 &&
    isInternationalPhone(phone) &&
    emailOk(email);

  const steps = useMemo((): DetailStep[] => {
    const list: DetailStep[] = [
      {
        id: 'bookFor',
        label: ar ? 'هل الحجز لك؟' : 'Is this booking for you?',
        done: bookingForPicked,
        focusId: 'lease-book-for-self',
        body: (
          <div
            className="lease-checkout__modes"
            role="radiogroup"
            aria-label={ar ? 'هل الحجز لك؟' : 'Booking for'}
          >
            <button
              type="button"
              id="lease-book-for-self"
              role="radio"
              aria-checked={bookingFor === 'self' && bookingForPicked}
              className={`button ${bookingFor === 'self' && bookingForPicked ? 'button--primary' : 'button--quiet'}`}
              onClick={() => {
                onBookingFor('self');
                setBookingForPicked(true);
                setEntityPicked(false);
              }}
            >
              {ar ? 'نعم، الحجز لي' : 'Yes, for me'}
            </button>
            <button
              type="button"
              id="lease-book-for-other"
              role="radio"
              aria-checked={bookingFor === 'other' && bookingForPicked}
              className={`button ${bookingFor === 'other' && bookingForPicked ? 'button--primary' : 'button--quiet'}`}
              onClick={() => {
                onBookingFor('other');
                setBookingForPicked(true);
                setEntityPicked(false);
              }}
            >
              {ar ? 'لا، لشخص آخر' : 'No, for someone else'}
            </button>
          </div>
        ),
      },
    ];

    if (bookingForPicked && bookingFor === 'other') {
      list.push({
        id: 'entityType',
        label: ar ? 'شخصي أو شركة' : 'Personal or company',
        done: entityPicked,
        focusId: 'lease-other-person',
        body: (
          <div
            className="lease-checkout__modes"
            role="radiogroup"
            aria-label={ar ? 'شخصي أو شركة' : 'Person or company'}
          >
            <button
              type="button"
              id="lease-other-person"
              role="radio"
              aria-checked={entityType === 'person' && entityPicked}
              className={`button ${entityType === 'person' && entityPicked ? 'button--primary' : 'button--quiet'}`}
              onClick={() => {
                onEntityType('person');
                setEntityPicked(true);
              }}
            >
              {ar ? 'شخصي' : 'Personal'}
            </button>
            <button
              type="button"
              id="lease-other-company"
              role="radio"
              aria-checked={entityType === 'company' && entityPicked}
              className={`button ${entityType === 'company' && entityPicked ? 'button--primary' : 'button--quiet'}`}
              onClick={() => {
                onEntityType('company');
                setEntityPicked(true);
              }}
            >
              {ar ? 'شركة' : 'Company'}
            </button>
          </div>
        ),
      });
    }

    if (!pathReady) return list;

    list.push(
      {
        id: 'name',
        label: forCompany
          ? ar
            ? 'اسم الشركة'
            : 'Company name'
          : ar
            ? 'الاسم الكامل'
            : 'Full name',
        done: fullName.trim().length >= 2,
        focusId: showSaved ? 'lease-book-saved' : 'lease-book-name',
        body: (
          <>
            <p className="muted stays-checkout__hint">
              {bookingFor === 'self'
                ? ar
                  ? 'جلبنا بياناتك من ملفك — راجعها وأكمل ما ينقص قبل المتابعة.'
                  : 'We loaded your details from your profile — review them and fill anything missing.'
                : forCompany
                  ? ar
                    ? 'أدخل بيانات الشركة. ستُكمل تفاصيل السجل والمفوّضين في الخطوة التالية.'
                    : 'Enter the company details. You will complete CR and signatories in the next step.'
                  : ar
                    ? 'أدخل بيانات الشخص الذي سيتم الحجز باسمه.'
                    : 'Enter the details of the person the booking is for.'}
            </p>
            {showSaved ? (
              <div className="field">
                <label htmlFor="lease-book-saved">
                  {ar ? 'اختر من الأشخاص المحفوظين في ملفك' : 'Choose a saved person'}
                </label>
                <select
                  className="select"
                  id="lease-book-saved"
                  value={savedContactId}
                  onChange={(event) => onSavedContact(event.target.value)}
                >
                  <option value={NEW_CONTACT}>{ar ? '+ شخص جديد' : '+ New person'}</option>
                  {contacts.saved.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.fullName}
                      {row.phone ? ` — ${row.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="lease-book-name">
                {bookingFor === 'self'
                  ? ar
                    ? 'الاسم الكامل (كما في البطاقة)'
                    : 'Full name (as on ID)'
                  : forCompany
                    ? ar
                      ? 'اسم الشركة'
                      : 'Company name'
                    : ar
                      ? 'اسم الشخص الكامل (كما في البطاقة)'
                      : 'Their full name (as on ID)'}
                <span aria-hidden="true"> *</span>
              </label>
              <input
                className="input"
                id="lease-book-name"
                type="text"
                required
                minLength={2}
                maxLength={forCompany ? 200 : 160}
                value={fullName}
                onChange={(event) => onFormChange({ fullName: event.target.value })}
                autoComplete={bookingFor === 'self' ? 'name' : 'organization'}
              />
            </div>
          </>
        ),
      },
      {
        id: 'phone',
        label: forCompany
          ? ar
            ? 'هاتف الشركة'
            : 'Company phone'
          : ar
            ? 'الهاتف'
            : 'Phone',
        done: isInternationalPhone(phone),
        focusId: 'lease-book-phone',
        body: (
          <InternationalPhoneField
            key={`${bookingFor}:${entityType}:${savedContactId}`}
            id="lease-book-phone"
            label={
              forCompany
                ? ar
                  ? 'هاتف الشركة'
                  : 'Company phone'
                : ar
                  ? 'الهاتف'
                  : 'Phone'
            }
            value={phone}
            onChange={(next) => onFormChange({ phone: next })}
            locale={locale}
            required
            autoComplete={bookingFor === 'self' ? 'tel' : 'off'}
          />
        ),
      },
      {
        id: 'email',
        label: forCompany
          ? ar
            ? 'بريد الشركة'
            : 'Company email'
          : ar
            ? 'البريد الإلكتروني'
            : 'Email',
        done: emailOk(email),
        focusId: 'lease-book-email',
        body: (
          <div className="field">
            <label htmlFor="lease-book-email">
              {forCompany
                ? ar
                  ? 'بريد الشركة'
                  : 'Company email'
                : ar
                  ? 'البريد الإلكتروني'
                  : 'Email'}
              <span aria-hidden="true"> *</span>
            </label>
            <input
              className="input"
              id="lease-book-email"
              type="email"
              required
              value={email}
              onChange={(event) => onFormChange({ email: event.target.value })}
              autoComplete={bookingFor === 'self' ? 'email' : 'off'}
              dir="ltr"
            />
          </div>
        ),
      },
    );

    return list;
  }, [
    ar,
    bookingFor,
    bookingForPicked,
    entityType,
    entityPicked,
    pathReady,
    forCompany,
    showSaved,
    contacts.saved,
    savedContactId,
    fullName,
    phone,
    email,
    locale,
    onBookingFor,
    onEntityType,
    onSavedContact,
    onFormChange,
  ]);

  const firstIncomplete = steps.findIndex((step) => !step.done);
  const frontier =
    firstIncomplete === -1
      ? Math.max(steps.length - 1, 0)
      : Math.min(Math.max(unlocked, firstIncomplete), Math.max(steps.length - 1, 0));
  const detailsComplete = firstIncomplete === -1;
  const prevFrontier = useRef(frontier);

  useEffect(() => {
    setUnlocked(0);
    setViewIndex(0);
    lastFocused.current = null;
    prevFrontier.current = 0;
  }, [bookingFor, entityType]);

  useEffect(() => {
    if (frontier > prevFrontier.current) setViewIndex(frontier);
    prevFrontier.current = frontier;
  }, [frontier]);

  useEffect(() => {
    const current = steps[frontier];
    if (!current?.done || frontier >= steps.length - 1) return;
    const timer = window.setTimeout(() => {
      const next = frontier + 1;
      setUnlocked((currentUnlock) => Math.max(currentUnlock, next));
      setViewIndex(next);
      const nextStep = steps[next];
      if (nextStep?.focusId) {
        lastFocused.current = nextStep.focusId;
        focusStepField(nextStep.focusId);
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [frontier, steps]);

  useEffect(() => {
    const current = steps[viewIndex];
    if (!current?.focusId || current.done) return;
    if (lastFocused.current === `${viewIndex}:${current.focusId}`) return;
    lastFocused.current = `${viewIndex}:${current.focusId}`;
    focusStepField(current.focusId);
  }, [viewIndex, steps]);

  const progressDone = steps.filter((step) => step.done).length;
  const safeIndex = Math.min(Math.max(viewIndex, 0), Math.max(frontier, 0));
  const currentStep = steps[safeIndex];
  const canGoBack = safeIndex > 0;
  const canGoNext = safeIndex < frontier && Boolean(currentStep?.done);

  function goBack() {
    if (!canGoBack) return;
    lastFocused.current = null;
    setViewIndex(safeIndex - 1);
  }

  function goNext() {
    if (!canGoNext) return;
    lastFocused.current = null;
    setViewIndex(safeIndex + 1);
  }

  return (
    <div className="party-form party-form--progressive party-form--current-only">
      <div className="party-form__progress" aria-live="polite">
        <strong>
          {ar
            ? `خطوة ${Math.min(safeIndex + 1, Math.max(steps.length, 1))} من ${Math.max(steps.length, 1)}`
            : `Step ${Math.min(safeIndex + 1, Math.max(steps.length, 1))} of ${Math.max(steps.length, 1)}`}
        </strong>
        <span>
          {ar
            ? `${progressDone} مكتملة — عبّئ حقلاً واحداً في كل مرة`
            : `${progressDone} done — fill one field at a time`}
        </span>
        <div className="party-form__progress-track" aria-hidden="true">
          <div
            className="party-form__progress-bar"
            style={{ width: `${steps.length ? (progressDone / steps.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {currentStep ? (
        <div
          key={`${currentStep.id}:${bookingFor}:${entityType}`}
          className={`party-form__step is-current${currentStep.done ? ' is-done' : ''}`}
        >
          <div className="party-form__step-head" aria-current="step">
            <span className="party-form__step-index" aria-hidden="true">
              {currentStep.done ? '✓' : safeIndex + 1}
            </span>
            <span>{currentStep.label}</span>
            <em>{ar ? 'الآن' : 'Now'}</em>
          </div>
          <div className="party-form__step-body">{currentStep.body}</div>
          <div className="party-form__step-nav">
            {canGoBack ? (
              <button type="button" className="button button--quiet" onClick={goBack}>
                {ar ? 'رجوع' : 'Back'}
              </button>
            ) : (
              <span />
            )}
            {canGoNext ? (
              <button type="button" className="button button--primary" onClick={goNext}>
                {ar ? 'متابعة' : 'Continue'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showSave && detailsComplete ? (
        <label className="checkbox-row lease-checkout__accept" htmlFor="lease-book-save">
          <input
            id="lease-book-save"
            type="checkbox"
            checked={saveContact}
            onChange={(event) => onSaveContact(event.target.checked)}
          />
          <span>
            {bookingFor === 'self'
              ? ar
                ? 'حفظ رقم هاتفي في ملفي لاستخدامه في الحجوزات القادمة'
                : 'Save my phone number to my profile for future bookings'
              : savedContactId !== NEW_CONTACT
                ? ar
                  ? 'تحديث بيانات هذا الشخص المحفوظة في ملفي'
                  : 'Update this saved person in my profile'
                : ar
                  ? 'حفظ بيانات هذا الشخص في ملفي لحجز آخر'
                  : 'Save this person to my profile for another booking'}
          </span>
        </label>
      ) : null}
    </div>
  );
}
