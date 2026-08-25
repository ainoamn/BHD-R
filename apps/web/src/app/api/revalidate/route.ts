import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

/**
 * On-demand cache invalidation for public listings.
 * POST { "tags": ["public-listings"] } with header x-revalidate-secret.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || request.headers.get('x-revalidate-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { tags?: string[] } | null;
  const tags = body?.tags?.filter((tag) => typeof tag === 'string' && tag.length > 0) ?? [
    'public-listings',
  ];
  for (const tag of tags.slice(0, 32)) {
    revalidateTag(tag, 'max');
  }
  return NextResponse.json({ revalidated: true, tags });
}
