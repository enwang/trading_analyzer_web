import { ReportDeckScreen } from '@/components/report/report-deck-screen'

export default async function ReportViewPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string }>
}) {
  const { refresh } = await searchParams
  return <ReportDeckScreen initialRefresh={refresh === '1'} />
}
