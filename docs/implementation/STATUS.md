# Implementation status

**Updated:** 2026-10-08  
**Product version:** 0.6.1  
**Active focus:** Property hub records — booking approval → contract → lease, manual lease and sale contracts, and lease registration with bhd-om financial terms  
**Release 0.6.1:** [`RELEASE-0.6.1-AR.md`](./RELEASE-0.6.1-AR.md)  
**Lease registration reference:** [`LEASE-REGISTRATION-AR.md`](./LEASE-REGISTRATION-AR.md)  
**Session handoff:** [`../handoffs/2026-10-08-property-leasing-0.6.1/README.md`](../handoffs/2026-10-08-property-leasing-0.6.1/README.md)

## Recent releases (2026-10-07 → 2026-10-08)

| Version         | Focus                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0.6.1           | Lease registration: tenant details, VAT / municipality / registration fees, grace, extras and discounts, cheque schedule |
| 0.6.0           | Booking approval issues a signed (or manager-routed) lease contract; manual lease and sale contracts                     |
| 0.5.9           | Property hub sections read from Neon for that property only                                                              |
| 0.5.8           | Property hub sections render inside the property page (`?section=`)                                                      |
| 0.5.7           | Sidebar «العقارات» dropdown: view vs. manage properties                                                                  |
| 0.5.0 – 0.5.6   | Daily stays screens and booking page redesign, payment gateway message fix                                               |
| 0.4.89 – 0.4.99 | Booking terms, deposits, unified calendar, Vercel region `lhr1`                                                          |

Full list: [`../../CHANGELOG.md`](../../CHANGELOG.md).

## Open items

- `next-write-route-policy.test.ts`: two pre-existing failures (public stays routes without CSRF; `lifecycle`, `stays/day-override`, `stays/setup` without `clientSafeErrorCode`).
- `proxy-canonical-host.test.ts`: fails to resolve `next/server` from inside `next-intl` under Vitest.
- Lease payment schedules do not generate invoices yet; cheques are recorded for accounting review.

Session policy (0.4.88): [`../BHD-SESSION-POLICY.md`](../BHD-SESSION-POLICY.md)
