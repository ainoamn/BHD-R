import { PortalSection } from '@/components/portal-section';
export default async function Page({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  return <PortalSection portal="owner" segments={section} />;
}
