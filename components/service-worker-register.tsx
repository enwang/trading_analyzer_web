'use client'

import { useEffect } from 'react'

// Registers public/sw.js in production builds only. The worker makes repeat
// opens fast (hashed assets served from the Cache Storage) while page data
// stays network-first — see sw.js for the caching rules.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failing (unsupported browser, private mode) just means
      // no offline cache — the app works exactly as before.
    })
  }, [])
  return null
}
