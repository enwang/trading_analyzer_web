'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'

const TRADES_LAST_URL_STORAGE_KEY = 'trades-table-last-url'
const TRADES_LAST_SCROLL_STORAGE_KEY = 'trades-table-last-scroll'
const DASHBOARD_SCROLL_CONTAINER_ID = 'dashboard-scroll-container'

function restoreTradesScroll() {
  const raw = window.sessionStorage.getItem(TRADES_LAST_SCROLL_STORAGE_KEY)
  if (!raw) return
  const scrollTop = Number(raw)
  if (!Number.isFinite(scrollTop)) return

  const container = document.getElementById(DASHBOARD_SCROLL_CONTAINER_ID)
  if (!container) return
  container.scrollTop = scrollTop
}

export function BackToTradesButton({ href }: { href: string }) {
  const router = useRouter()

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={() => {
        const lastTradesUrl = window.sessionStorage.getItem(TRADES_LAST_URL_STORAGE_KEY)
        router.push(lastTradesUrl || href, { scroll: false })

        for (const delay of [0, 50, 150, 300, 600, 1000]) {
          window.setTimeout(() => {
            restoreTradesScroll()
          }, delay)
        }
      }}
    >
      <ArrowLeft className="size-4" />
      Back to Trades
    </Button>
  )
}
