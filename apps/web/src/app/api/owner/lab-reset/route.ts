import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Legacy path — lab reset lives under /api/site-admin/lab-reset. */
export async function GET() {
  return NextResponse.json({ error: { code: 'gone', moveTo: '/api/site-admin/lab-reset' } }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: { code: 'gone', moveTo: '/api/site-admin/lab-reset' } }, { status: 410 });
}
