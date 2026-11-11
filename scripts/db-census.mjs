// Read-only production DB census. Loads credentials from .env.deploy.local via --env-file.
// Prints counts and timestamps only — never a password, never a full connection string.
import { Pool } from '@neondatabase/serverless'

const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!conn) { console.log('NO_DATABASE_URL'); process.exit(0) }
console.log('db backend host =', (() => { try { return new URL(conn).hostname } catch { return 'unparsable' } })())
console.log('PILOT_REGISTRATION_MODE in this env file =', JSON.stringify(process.env.PILOT_REGISTRATION_MODE ?? null))
console.log('PILOT_DAILY_PULSE_ENABLED =', JSON.stringify(process.env.PILOT_DAILY_PULSE_ENABLED ?? null))
console.log('PILOT_TELEGRAM_SEND_ENABLED =', JSON.stringify(process.env.PILOT_TELEGRAM_SEND_ENABLED ?? null))
console.log('CRON_SECRET present =', Boolean(process.env.CRON_SECRET))

const pool = new Pool({ connectionString: conn })
const q = async (sql, p) => (await pool.query(sql, p)).rows

try {
  const t = await q("select table_name from information_schema.tables where table_schema='public' order by 1")
  console.log('\ntables:', t.map((x) => x.table_name).join(', '))

  const names = t.map((x) => x.table_name)
  for (const name of ['users', 'sessions', 'telegram_links', 'newsletter_subscribers', 'audit_log', 'waitlist', 'signups', 'subscribers']) {
    if (!names.includes(name)) continue
    const c = await q(`select count(*)::int as n from ${name}`)
    let extra = ''
    try {
      const cols = await q('select column_name from information_schema.columns where table_name=$1', [name])
      const cn = cols.map((x) => x.column_name)
      const tsCol = cn.find((x) => /created_at|inserted_at|timestamp|subscribed/i.test(x))
      if (tsCol) {
        const r = await q(`select min(${tsCol}) as first_ts, max(${tsCol}) as last_ts from ${name}`)
        extra = `  [${tsCol}: first=${r[0].first_ts} last=${r[0].last_ts}]`
      }
      if (name === 'users' && cn.includes('plan')) {
        const pl = await q('select plan, count(*)::int as n from users group by plan')
        extra += `  plans=${JSON.stringify(pl)}`
      }
      if (name === 'users' && cn.includes('email')) {
        const em = await q("select split_part(email,'@',2) as dom, count(*)::int as n from users group by dom")
        extra += `  email-domains=${JSON.stringify(em)}`
      }
    } catch (e) { extra = `  (ts probe failed: ${e.message})` }
    console.log(`  ${name}: ${c[0].n} rows${extra}`)
  }

  // Are the landing and the pilot the SAME database? The landing writes newsletter_subscribers.
  const hasNewsletter = names.includes('newsletter_subscribers')
  console.log('\nlanding/pilot share this DB?  newsletter_subscribers here =', hasNewsletter)
  if (hasNewsletter) {
    const n = await q('select count(*)::int as n from newsletter_subscribers')
    console.log('  newsletter_subscribers rows =', n[0].n, '=> waitlist captured into the pilot DB')
  }

  // Recent activity, to answer "is anyone actually using this / is the cron firing"
  try {
    const acts = await q("select action, count(*)::int as n, max(created_at) as last from audit_log where created_at > now() - interval '21 days' group by action order by n desc limit 25")
    console.log('\naudit_log last 21 days:')
    for (const a of acts) console.log(`   ${String(a.n).padStart(4)}  ${a.action}   last=${a.last}`)
    if (!acts.length) console.log('   (zero rows -> nothing has run or nobody has signed in)')
  } catch (e) { console.log('audit_log query failed:', e.message) }

  try {
    const u = await q("select email, display_name, plan, created_at from users order by created_at asc limit 25")
    console.log('\naccounts (first 25, local-part masked to initial):')
    for (const r of u) console.log(`   ${r.email.replace(/^(.{1}).*(@.*)$/, '$1***$2')}  plan=${r.plan}  name=${r.display_name}  ${r.created_at}`)
  } catch (e) { console.log('users list failed:', e.message) }
} catch (e) {
  console.log('DB UNREACHABLE FROM HERE:', e.message)
} finally { await pool.end() }
