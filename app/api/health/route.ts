import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'creator-os-pilot',
    hosted: process.env.PILOT_HOSTED === 'true',
    dbPath: process.env.PILOT_DB_PATH || null,
    time: new Date().toISOString(),
  })
}
