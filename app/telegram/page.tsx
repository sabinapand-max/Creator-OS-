'use client'

// Private-pilot Telegram pairing screen.
//
// The link code is issued by the server against the signed-in session only.
// This page never accepts or displays a user id, and it never treats the deep
// link as proof of a link — it is only a convenience that pre-fills /start.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface LinkResponse {
  code: string
  expiresAt: string
  botUsername: string
  deepLink: string | null
}

export default function TelegramLinkPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [issued, setIssued] = useState<LinkResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  // Who am I? state is the only place the browser learns the session is valid.
  // There are three outcomes, not two: a session that is absent and a session that
  // could not be read are different facts and must never render the same sentence.
  const checkSession = useCallback(async () => {
    setUnreachable(false)
    try {
      const response = await fetch('/api/pilot/state', { cache: 'no-store' })
      // A cold Render instance answers with an HTML gateway error, which is not
      // evidence that anybody is signed out.
      if (!response.ok) throw new Error(`state_http_${response.status}`)
      const data = (await response.json()) as { signedIn?: boolean; user?: { displayName?: string } }
      setSignedIn(Boolean(data.signedIn))
      setDisplayName(data.user?.displayName ?? '')
    } catch {
      setSignedIn(null)
      setUnreachable(true)
    }
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  // A code is short-lived on purpose, so show the clock rather than let it die silently.
  // The first tick runs synchronously: delaying it made a brand-new code render as
  // "expired" for one frame, and left the previous code's countdown on screen after a
  // regenerate, because secondsLeft still held the old value.
  useEffect(() => {
    if (!issued) return
    let timer: ReturnType<typeof setInterval>
    const tick = () => {
      const remaining = Math.max(0, Math.round((new Date(issued.expiresAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) clearInterval(timer)
    }
    tick()
    timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [issued])

  const request = useCallback(async () => {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const response = await fetch('/api/telegram/link', { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(String(data.error ?? `Link request failed (${response.status}).`))
        setIssued(null)
        return
      }
      setIssued({
        code: String(data.code ?? ''),
        expiresAt: String(data.expiresAt ?? ''),
        botUsername: String(data.botUsername ?? ''),
        deepLink: typeof data.deepLink === 'string' ? data.deepLink : null
      })
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }, [])

  const copy = useCallback(async () => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.code)
      setCopied(true)
    } catch {
      setError('Copy was blocked by the browser — select the code and copy it manually.')
    }
  }, [issued])

  const expired = issued !== null && secondsLeft === 0

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <p className="text-xs tracking-[0.3em] text-emerald-300 uppercase">Creator OS · private pilot</p>
        <h1 className="text-2xl font-semibold text-white">Telegram doorway</h1>
        <p className="text-sm text-slate-400">
          Pair one Telegram chat with your account. Hermes replies only in the chat you link here.
        </p>
      </header>

      {signedIn === null && !unreachable && <p className="text-sm text-slate-400">Checking your session…</p>}

      {unreachable && (
        <section className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-5">
          <p className="text-sm text-slate-300">
            The pilot server could not confirm your session. On a free Render instance this almost
            always means it is still waking up — it does not mean you were signed out.
          </p>
          <button
            type="button"
            onClick={() => void checkSession()}
            className="mt-4 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950"
          >
            Try again
          </button>
        </section>
      )}

      {signedIn === false && (
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-slate-300">
            This browser has no pilot session, so there is nothing to link yet.
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Sign in — or register, if the pilot database was redeployed since your last visit, which
            removes old accounts — then come back here. The Telegram entry sits in the sidebar once
            you are signed in.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950"
          >
            Go to sign in
          </Link>
        </section>
      )}

      {signedIn === true && (
        <section className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-slate-300">
            Signed in as <span className="font-medium text-white">{displayName || 'this account'}</span>.
          </p>

          <button
            type="button"
            onClick={() => {
              void request()
            }}
            disabled={busy}
            className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            {busy ? 'Requesting…' : issued ? 'Generate a new code' : 'Generate link code'}
          </button>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          {issued && !expired && (
            <div className="space-y-3 rounded-lg border border-emerald-400/40 bg-emerald-400/10 p-4">
              <p className="text-xs tracking-[0.2em] text-slate-400 uppercase">Your one-time code</p>
              <div className="flex flex-wrap items-center gap-3">
                <code className="select-all font-mono text-2xl tracking-widest text-white">{issued.code}</code>
                <button
                  type="button"
                  onClick={() => {
                    void copy()
                  }}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-200"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <p className="text-sm text-slate-300">
                Open Telegram and message{' '}
                <span className="font-medium text-white">
                  {issued.botUsername ? `@${issued.botUsername}` : 'the Creator OS bot'}
                </span>{' '}
                with:
              </p>
              <p className="select-all rounded-md bg-slate-950/80 px-3 py-2 font-mono text-sm text-white">
                /start {issued.code}
              </p>

              {issued.deepLink && (
                <a
                  href={issued.deepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-sm text-emerald-300 underline"
                >
                  Open this link in Telegram instead
                </a>
              )}

              <p className="text-xs text-slate-400">
                Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} · works once
                · generating a new code voids this one.
              </p>
            </div>
          )}

          {issued && expired && (
            <p className="text-sm text-amber-300">
              That code expired. Generate a new one and send <span className="font-mono">/start CODE</span> again.
            </p>
          )}

          <p className="text-xs leading-relaxed text-slate-400">
            Never send just your Telegram username — the code is what ties this chat to your account. One chat per
            account. Group chats are refused. If this code leaks, generate a new one and the old one stops working.
          </p>

          {/* This page sits outside the app shell, so give people a way back. */}
          <Link href="/" className="inline-block text-sm text-emerald-300 underline">
            Back to dashboard
          </Link>
        </section>
      )}
    </main>
  )
}
