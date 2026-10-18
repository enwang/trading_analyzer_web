import { BUILD_VERSION } from '@/lib/build-version'
import { NextResponse } from 'next/server'

// Always answer with THIS deployment's build version, never a cached one, so
// open clients can notice a newer deployment and refresh themselves.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { version: BUILD_VERSION },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
