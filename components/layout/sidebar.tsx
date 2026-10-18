'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import {
  BarChart2,
  FileBarChart2,
  List,
  LineChart,
  Moon,
  NotebookPen,
  Sun,
  Upload,
  LayoutDashboard,
  LogOut,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/trades', label: 'Trades', icon: List },
  { href: '/analysis', label: 'Analysis', icon: BarChart2 },
  { href: '/notes', label: 'Notes', icon: NotebookPen },
  { href: '/report', label: 'Report', icon: FileBarChart2 },
  { href: '/import', label: 'Import', icon: Upload },
]

interface SidebarProps {
  mobileOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { resolvedTheme, setTheme } = useTheme()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      className={cn(
        // Mobile: fixed slide-in drawer. Desktop (md+): static column, as before.
        'fixed inset-y-0 left-0 z-40 flex h-full w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 md:static md:z-auto md:h-screen md:w-52 md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <LineChart className="size-5 shrink-0" />
        <span className="truncate font-semibold text-sm">Trading Journal</span>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="ml-auto rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:hidden"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            prefetch={false}
            onClick={onClose}
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

      <div className="border-t px-2 py-3 space-y-0.5">
        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {resolvedTheme === 'dark' ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
          {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
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
