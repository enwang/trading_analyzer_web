// Build version baked into this bundle at build time. next.config.ts maps it
// from VERCEL_GIT_COMMIT_SHA (set automatically by Vercel for git
// deployments). Builds without that variable get 'dev', which disables the
// client version checker (see components/version-checker.tsx).
export const BUILD_VERSION: string =
  process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'dev'
