'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  BarChart2,
  FileBarChart2,
  List,
  LineChart,
  Upload,
  LayoutDashboard,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/trades', label: 'Trades', icon: List },
  { href: '/analysis', label: 'Analysis', icon: BarChart2 },
  { href: '/report', label: 'Report', icon: FileBarChart2 },
  { href: '/import', label: 'Import', icon: Upload },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="flex h-screen w-52 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <LineChart className="size-5 shrink-0" />
        <span className="truncate font-semibold text-sm">Trading Journal</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="border-t px-2 py-3">
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="size-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
