/**
 * Minimal transactional email via AgentMail.
 *
 * Used for password-recovery codes only. The send is best-effort: a failure
 * never changes the caller's (enumeration-safe) response, it is only logged.
 * Credentials come from the environment; with no key configured the helper
 * quietly reports "not sent" so tests and local dev never touch the network.
 */
const AGENTMAIL_BASE = 'https://api.agentmail.to/v0'
const DEFAULT_INBOX = 'trisindigo@agentmail.to'

export async function sendAgentMail(input: {
  to: string
  subject: string
  text: string
}): Promise<boolean> {
  const key = process.env.AGENTMAIL_API_KEY
  if (!key) return false
  const inbox = encodeURIComponent(process.env.AGENTMAIL_INBOX || DEFAULT_INBOX)
  try {
    const res = await fetch(`${AGENTMAIL_BASE}/inboxes/${inbox}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: input.to, subject: input.subject, text: input.text }),
    })
    if (!res.ok) {
      console.error(`[mail] send failed ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[mail] send error:', err instanceof Error ? err.message : err)
    return false
  }
}
