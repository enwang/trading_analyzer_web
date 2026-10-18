'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { LineChart, Menu } from 'lucide-react'
import { Sidebar } from '@/components/layout/sidebar'
import { PageTransition } from '@/components/layout/page-transition'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Navigating (e.g. via a link outside the drawer) closes the mobile drawer.
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar: only shown below md, where the sidebar is a drawer. */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1.5 text-foreground hover:bg-muted"
          >
            <Menu className="size-5" />
          </button>
          <LineChart className="size-5 shrink-0" />
          <span className="truncate font-semibold text-sm">Trading Journal</span>
        </header>
        <main id="dashboard-scroll-container" className="flex-1 overflow-y-auto bg-background p-4 md:p-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  )
}
