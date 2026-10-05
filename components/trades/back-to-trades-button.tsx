'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'

const TRADES_LAST_URL_STORAGE_KEY = 'trades-table-last-url'

export function BackToTradesButton({ href }: { href: string }) {
  const router = useRouter()

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={() => {
        const lastTradesUrl = window.sessionStorage.getItem(TRADES_LAST_URL_STORAGE_KEY)
        if (lastTradesUrl && window.history.length > 1) {
          router.back()
          return
        }
        router.push(href, { scroll: false })
      }}
    >
      <ArrowLeft className="size-4" />
      Back to Trades
    </Button>
  )
}
