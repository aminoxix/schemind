import type { DriftReport, Reporter, Severity } from '../types.js'
import { driftToMarkdown } from './markdown.js'
import { warnIfHardcodedSecret } from './secrets.js'

type FetchFn = typeof globalThis.fetch

const MARKER = '<!-- schemind-drift -->'

/** Configuration for {@link githubReporter}. */
export interface GitHubReporterOptions {
  /** GitHub token with `pull-requests: write`. */
  token: string
  /** Repository as `owner/name`. */
  repo: string
  /** Pull-request number to comment on. */
  pullNumber: number
  /** Only include these severities. Default: all. */
  notifyOn?: readonly Severity[]
  /** API base. Default `https://api.github.com` (set for GHES). */
  apiUrl?: string
  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchFn
}

/**
 * Posts (and on subsequent reports, **updates**) a single PR comment with a
 * drift table — so the PR that caused the drift carries the report inline. A
 * hidden marker is used to find and upsert the comment rather than spam new ones.
 */
export function githubReporter(options: GitHubReporterOptions): Reporter {
  warnIfHardcodedSecret(options.token, 'github token')
  const seen: DriftReport[] = []
  let commentId: number | null = null

  return {
    name: 'github',
    async report(drift: DriftReport): Promise<void> {
      if (options.notifyOn && !options.notifyOn.includes(drift.severity)) return
      seen.push(drift)

      const api = options.apiUrl ?? 'https://api.github.com'
      const doFetch = options.fetch ?? globalThis.fetch
      const headers = {
        authorization: `Bearer ${options.token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'schemind',
      }
      const body = `${MARKER}\n${driftToMarkdown(seen)}`

      // Locate an existing schemind comment once.
      if (commentId === null) {
        const res = await doFetch(
          `${api}/repos/${options.repo}/issues/${options.pullNumber}/comments?per_page=100`,
          { headers },
        )
        if (res.ok) {
          const comments = (await res.json()) as Array<{ id: number; body?: string }>
          const existing = comments.find((c) => c.body?.includes(MARKER))
          if (existing) commentId = existing.id
        }
      }

      if (commentId !== null) {
        await doFetch(`${api}/repos/${options.repo}/issues/comments/${commentId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ body }),
        })
      } else {
        const res = await doFetch(
          `${api}/repos/${options.repo}/issues/${options.pullNumber}/comments`,
          { method: 'POST', headers, body: JSON.stringify({ body }) },
        )
        if (res.ok) commentId = ((await res.json()) as { id: number }).id
      }
    },
  }
}
