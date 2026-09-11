/**
 * Locale-level loading stays empty so portal soft-nav does not flash.
 * Marketing detail routes use their own loading.tsx skeletons
 * (units/[unitId], properties/[propertyId]).
 */
export default function Loading() {
  return null;
}
