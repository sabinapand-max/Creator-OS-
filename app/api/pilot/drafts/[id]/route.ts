/**
 * Delete one draft.
 *
 * Ownership is enforced twice: `requireUser` resolves the caller from the
 * session cookie, and the delete itself carries `user_id` in its WHERE clause,
 * so another pilot user's draft id resolves to 404 rather than deleting
 * anything. The row is soft-deleted, keeping an audit trail while making the
 * draft disappear from every listing.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import { deleteDraft } from '@/lib/pilot/core/drafts.ts'
import { requireUser } from '@/lib/pilot/web/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(getDb())
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ ok: false, error: 'A draft id is required.' }, { status: 400 })

  const deleted = deleteDraft(getDb(), auth.userId, id)
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: 'That draft is not yours or has already been deleted.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, deleted: id })
}
