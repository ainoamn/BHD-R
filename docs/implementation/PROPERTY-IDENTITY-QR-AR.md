# Property page identity & QR (0.2.49)

## What you see on Property 360

| Field | Source |
| ----- | ------ |
| Serial / property no. | `properties.serial_number` (e.g. `BHD-2026-PRP-R-0001`) |
| Owner name | Current row in `property_ownership_interests` → `parties.displayName` |
| Address & location | `addresses` (street · area · city · wilayat · governorate) |
| QR code | Client-generated (`qrcode`) → absolute URL of `/{locale}/{portal}/properties/{id}` |

Scanning the QR opens the same Property 360 page on the current host (Vercel preview or custom domain).

## Create / edit flow

- Create: `/api/owner/properties` (Vercel → Neon); redirects to Property 360.
- Duplicates: same `nameAr` + governorate/wilayat/city blocked; idempotency-key prevents double-submit.
- Ownership: wizard step «ownership documents» → choose party.
- Edit: `/{locale}/owner/properties/{id}/edit` reuses the wizard (`mode=edit`).

## Portfolio list

Columns: property no., name, owner, location, kind, units, status (Neon path preferred when `DATABASE_URL` is set).

## Deploy notes

- Production branch must be **`main`** (not Dependabot `typescript-6.0.3`).
- TypeScript pinned to `~5.9.3` via root `package.json` + pnpm overrides.
- Migration `0012_property_serials` required on Neon for serials/sequences.
