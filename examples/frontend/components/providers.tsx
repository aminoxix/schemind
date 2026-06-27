'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

export function Providers({ children }: { children: ReactNode }) {
  // A plain QueryClient. Observation is driven explicitly by the per-hook
  // helpers in lib/queries.ts (useSchemindQuery / useSchemindMutation /
  // wrapQueryFn), which carry correct endpoints + a 'tanstack' source tag, plus
  // schemindFetch at the transport layer. We deliberately do NOT wrap the client
  // with createSchemindQueryClient here: on a shared engine it would re-observe
  // every query/mutation under cache-derived keys (e.g. `POST /unknown`),
  // duplicating work and even observing the control-plane `useSetDrift`. The
  // zero-config `createSchemindQueryClient` pattern is documented in the README.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
