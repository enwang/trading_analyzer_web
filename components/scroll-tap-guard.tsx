'use client'

import { useEffect } from 'react'

// Touch scrolling that starts on a link can still end in a click on mobile
// browsers / the installed PWA, navigating away when the user only meant to
// scroll. This guard swallows the click that follows a touch gesture which
// actually moved (finger travelled) or scrolled the page. Genuine taps are
// untouched, and mouse/pen input is never intercepted.
export function ScrollTapGuard() {
  useEffect(() => {
    let downX = 0
    let downY = 0
    let downScrollY = 0
    let tracking = false

    const scrollY = () => {
      // The dashboard scrolls inside its own container; include the window too.
      const container = document.getElementById('dashboard-scroll-container')
      const el = document.scrollingElement
      return (container?.scrollTop ?? 0) + (el?.scrollTop ?? 0) + window.scrollY
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') {
        tracking = false
        return
      }
      tracking = true
      downX = e.clientX
      downY = e.clientY
      downScrollY = scrollY()
    }

    const onClick = (e: MouseEvent) => {
      if (!tracking) return
      tracking = false
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY)
      const scrolled = Math.abs(scrollY() - downScrollY)
      if (moved > 10 || scrolled > 4) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  return null
}
