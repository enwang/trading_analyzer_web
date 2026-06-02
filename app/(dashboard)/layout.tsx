import { Sidebar } from '@/components/layout/sidebar'
import { PageTransition } from '@/components/layout/page-transition'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main id="dashboard-scroll-container" className="flex-1 overflow-y-auto bg-background p-6">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  )
}
