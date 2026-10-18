'use client'

import { useEffect } from 'react'
import { BUILD_VERSION } from '@/lib/build-version'

const RELOADED_FOR_KEY = 'version-checker:reloaded-for'
const POLL_MS = 60_000

function isEditing() {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

// After a deploy, an already-open tab keeps running the old build (client
// router cache + edge propagation). This polls /api/version and reloads the
// page once when the server reports a different build, so a stale tab heals
// itself instead of needing manual refreshes. Safeguards:
// - at most one auto-reload per target version (sessionStorage), so a
//   persistent mismatch can never become a reload loop;
// - never reload while the user is editing a field (the next poll or focus
//   check catches up after they leave the field).
export function VersionChecker() {
  useEffect(() => {
    if (BUILD_VERSION === 'dev') return
    let cancelled = false

    async function check() {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { version?: string }
        const latest = data.version
        if (!latest || latest === 'dev' || latest === BUILD_VERSION) return
        if (cancelled || isEditing()) return
        if (sessionStorage.getItem(RELOADED_FOR_KEY) === latest) return
        sessionStorage.setItem(RELOADED_FOR_KEY, latest)
        window.location.reload()
      } catch {
        // Network hiccup — the next poll retries.
      }
    }

    void check()
    const id = window.setInterval(check, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  return null
}
