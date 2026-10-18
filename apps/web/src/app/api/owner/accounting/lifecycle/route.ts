import { NextResponse } from 'next/server';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import {
  cancelAccountingExpense,
  discardDraftJournal,
  setAccountingArchived,
  unpostJournal,
  voidAccountingInvoice,
} from '@/lib/accounting-gl-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

/** Draft delete, unpost, archive/restore, invoice void, expense cancel. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      kind?: string;
      id?: string;
    } | null;
    const id = body?.id?.trim() ?? '';
    if (!UUID.test(id) || !body?.action || !body.kind) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    if (body.action === 'discard' && body.kind === 'journal') {
      return NextResponse.json(await discardDraftJournal(claims, id));
    }
    if (body.action === 'unpost' && body.kind === 'journal') {
      return NextResponse.json(await unpostJournal(claims, id));
    }
    if (body.action === 'void' && body.kind === 'invoice') {
      return NextResponse.json(await voidAccountingInvoice(claims, id));
    }
    if (body.action === 'cancel' && body.kind === 'expense') {
      return NextResponse.json(await cancelAccountingExpense(claims, id));
    }
    if ((body.action === 'archive' || body.action === 'restore') && body.kind) {
      const resourceType =
        body.kind === 'journal'
          ? 'journal_entry'
          : body.kind === 'expense'
            ? 'expense'
            : body.kind === 'invoice'
              ? 'invoice'
              : null;
      if (!resourceType) {
        return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
      }
      return NextResponse.json(
        await setAccountingArchived(claims, resourceType, id, body.action === 'archive'),
      );
    }
    return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/lifecycle');
  }
}
