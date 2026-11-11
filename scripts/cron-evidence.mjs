// Read-only cron evidence check. Never prints any URL or secret.
import { Pool } from '@neondatabase/serverless'

const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!conn) {
  console.log('NO_DATABASE_URL_IN_ENV')
  process.exit(0)
}
const masked = conn.replace(/:[^:@/]*@/, ':****@')
console.log('conn host present =', masked.includes('neon.tech') || masked.includes('aws.postgresrds') || true)

const pool = new Pool({ connectionString: conn })
const q = async (sql, params) => (await pool.query(sql, params)).rows

try {
  const tables = await q("select table_name from information_schema.tables where table_schema='public' order by 1")
  console.log('tables:', tables.map((t) => t.table_name).join(', '))

  for (const name of ['audit_log', 'telegram_links', 'users']) {
    if (!tables.some((t) => t.table_name === name)) { console.log(`MISSING TABLE: ${name}`); continue }
    const cols = await q(
      "select column_name from information_schema.columns where table_name=$1 order by ordinal_position",
      [name],
    )
    console.log(`columns ${name}:`, cols.map((c) => c.column_name).join(', '))
  }

  const ver = await q("select value from pilot_meta where key='schema_version'").catch(() => [{ value: '?' }])
  console.log('schema_version =', JSON.stringify(ver))

  // 1. Did the daily pulse ever write its dedup marker?
  const pulse = await q(
    "select created_at, user_id, action from audit_log where action like '%daily_pulse%' order by created_at desc limit 12",
  ).catch((e) => { console.log('pulse query err:', e.message); return [] })
  console.log('daily_pulse rows (latest 12):', pulse.length)
  for (const r of pulse) console.log('   ', r.created_at, r.action, String(r.user_id).slice(0, 8))

  const since = await q(
    "select action, count(*)::int as n, max(created_at) as last from audit_log where created_at > now() - interval '10 days' group by action order by n desc limit 20",
  ).catch((e) => { console.log('agg err:', e.message); return [] })
  console.log('audit_log last 10 days by action:')
  for (const r of since) console.log('   ', String(r.n).padStart(4), r.action, '-> last', r.last)

  // 2. Who should have received it?
  const links = await q(
    'select count(*)::int as n from telegram_links where unlinked_at is null',
  ).catch((e) => { console.log('links err (trying variants):', e.message); return null })
  if (links) console.log('active telegram links =', links[0].n)
  else {
    const alt = await q("select table_name from information_schema.columns where column_name like 'unlinked_at%'").catch(() => [])
    console.log('tables with unlinked_at:', alt.map((a) => a.table_name).join(', '))
  }

  const users = await q('select count(*)::int as n from users').catch(() => [{ n: '?' }])
  console.log('total users =', users[0].n)
} catch (e) {
  console.log('QUERY FAILED:', e.message)
} finally {
  await pool.end()
}
