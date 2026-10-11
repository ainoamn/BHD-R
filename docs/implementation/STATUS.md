# Implementation status

**Updated:** 2026-10-11  
**Product version:** 0.7.0  
**Active focus:** Owner dashboard speed and redesign — phases 1–3 shipped (parallel loads, Neon reads and indexes, calm unified design); live page-by-page review and loading skeletons next  
**Release 0.6.3:** [`RELEASE-0.6.3-AR.md`](./RELEASE-0.6.3-AR.md)  
**Release 0.6.2:** [`RELEASE-0.6.2-AR.md`](./RELEASE-0.6.2-AR.md)  
**Release 0.6.1:** [`RELEASE-0.6.1-AR.md`](./RELEASE-0.6.1-AR.md)  
**Lease registration reference:** [`LEASE-REGISTRATION-AR.md`](./LEASE-REGISTRATION-AR.md)  
**Session handoff:** [`../handoffs/2026-10-08-property-leasing-0.6.1/README.md`](../handoffs/2026-10-08-property-leasing-0.6.1/README.md)

## Recent releases (2026-10-07 → 2026-10-11)

| Version         | Focus                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0.7.0           | Calm unified portal design: light sidebar, white headers without rainbow stripes, neutral metrics, calm forms and modals |
| 0.6.9           | All 12 Nest-only ops sections read from Neon (same permissions, org filter); full form context from Neon; 9 read indexes |
| 0.6.8           | Owner dashboard speed phase 1: one `set_config` statement per transaction, parallel loads, panels mount on first visit   |
| 0.6.7           | Guest cancel shows a no-refund warning; real date change from free days at calendar price (no refund on cheaper dates)   |
| 0.6.6           | Vacant units collapsed as a dropdown; operations modals full-screen and responsive (portal to body)                      |
| 0.6.5           | Bookings metrics collapsed as a dropdown; compact unified statistics cards across the site                               |
| 0.6.4           | Guest stay detail page fills the viewport on every device (no page scroll, pinned price and actions bar)                 |
| 0.6.3           | Guest stay detail page redesign: Omani landmark hero, status message, journey steps, date cards, price sidebar           |
| 0.6.2           | Bookings ordered by priority (approval first) with status colours; pending-approval alerts on dashboard and header bell  |
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
