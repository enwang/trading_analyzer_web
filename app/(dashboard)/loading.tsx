// Instant skeleton while a dashboard page's server data loads, so tab
// clicks respond immediately instead of leaving the previous page frozen
// until the full server render completes.
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden>
      <div className="h-8 w-48 rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-28 rounded-xl bg-muted" />
        <div className="h-28 rounded-xl bg-muted" />
        <div className="h-28 rounded-xl bg-muted" />
      </div>
      <div className="h-80 rounded-xl bg-muted" />
      <div className="h-64 rounded-xl bg-muted" />
    </div>
  )
}
