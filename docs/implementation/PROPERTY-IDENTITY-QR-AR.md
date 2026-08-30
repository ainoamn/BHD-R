# Property page identity & QR (0.2.53)

## What you see on Property 360

Booking-style read-only layout (gallery · title · price summary · map · amenities · units · docs · ownership). Editing only via **تعديل العقار**.

| Field | Source |
| ----- | ------ |
| Serial / property no. | `properties.serial_number` (e.g. `BHD-2026-PRP-R-0001`) |
| Owner name | Current row in `property_ownership_interests` → `parties.displayName` |
| Address & location | `addresses` (street · area · city · wilayat · governorate) |
| Maps / coords | `addresses.location` (PostGIS) + `Google Maps:` line in `property_profiles.notes` |
| Gallery | `unit_media` + `media_assets`; portal streams `/api/owner/media/:id` (Neon inline or R2) |
| Amenities / profile | `property_amenities`, `property_profiles`, `utility_meters`, `property_documents` |
| QR code | Client-generated (`qrcode`) → absolute URL of `/{locale}/{portal}/properties/{id}` |

Scanning the QR or «عرض العقار» opens the **public** property page (`/[locale]/properties/:id`) — same Property 360 marketing layout (gallery, map, amenities, units, viewing form). Catalogue cards link to `/[locale]/units/:id`, which renders that same layout focused on the listed unit.

## Create / edit flow

- Create: `/api/owner/properties` (Vercel → Neon); redirects to Property 360.
- Edit save: `PATCH /api/owner/properties/:id` updates address, owner, units, **profile (incl. maps notes), amenities, document metadata, meters**.
- New photos after edit still upload via Nest/BFF when available; text save succeeds even if upload fails.
- Duplicates: same `nameAr` + governorate/wilayat/city blocked; idempotency-key prevents double-submit.
- Ownership: wizard step «ownership documents» → choose party.
- Edit: `/{locale}/owner/properties/{id}/edit` reuses the wizard (`mode=edit`) with Neon-preferred hydration for maps/profile/gallery.

## Portfolio list

Columns: property no., name, owner, location, kind, units, status (Neon path preferred when `DATABASE_URL` is set).

**Next action (0.2.67+):** two buttons per row —

| Button | Opens |
| ------ | ----- |
| عرض العقار | Public marketing page `/{locale}/properties/:id` (new tab) |
| إدارة العقار | **Ops hub** `/{locale}/owner/properties/:id` — stats/alerts + scoped actions (booking deposit is set in **Edit property → Units**) |

Manage hub actions use `?propertyId=` on contracts / leasing / sales / bookings / maintenance / invoices.

Public catalogue cards (0.2.69) show a status watermark: available / for rent / for sale / reserved / leased / sold. Public CTAs require login: viewing request + book→deposit checkout. Booking deposit is set in **Edit property → Units** (`PropertyForm.deposit`, 0.2.72). Public listing page (0.2.73) shows **QR + share** (WhatsApp / Facebook / X / Telegram / LinkedIn / Instagram-native / copy). Catalogue heals publish flags and keeps reserved units visible with watermark.

## Deploy notes

- Production branch must be **`main`** (not Dependabot `typescript-6.0.3`).
- TypeScript pinned to `~5.9.3` via root `package.json` + pnpm overrides.
- Migration `0012_property_serials` required on Neon for serials/sequences.
- Gallery URLs for the owner portal use `/api/owner/media/:id` (works with Neon inline bytes when R2 buckets are missing). Set real `S3_BUCKET_PRIVATE` / `S3_BUCKET_PUBLIC` on Vercel for object storage; optional `PUBLIC_MEDIA_BASE_URL` only for a real CDN.
