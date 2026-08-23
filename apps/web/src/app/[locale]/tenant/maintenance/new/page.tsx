import { MaintenanceForm } from '@/components/maintenance-form';
import { apiFetch } from '@/lib/server-api';
import type { UnitOption } from '@/lib/types';
export default async function Page() {
  const payload = await apiFetch<{ data: UnitOption[] }>('/v1/tenant/units').catch(() => ({
    data: [],
  }));
  return <MaintenanceForm units={payload.data} />;
}
