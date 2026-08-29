import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export async function getAuthenticatedUserId() {
  const headerStore = await headers()
  const userId = headerStore.get('x-trading-user-id')
  if (!userId) redirect('/login')
  return userId
}
