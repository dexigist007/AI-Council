export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: { path: string; index: string; worktree: string }[]
}

export interface GitCommit {
  hash: string
  author: string
  date: string
  subject: string
}

export interface DiffLine {
  type: '+' | '-' | ' '
  text: string
  /** Line number in the new file (null for removed lines). */
  newLine: number | null
}

export interface DiffHunk {
  newStart: number
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath: string | null
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  binary: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

/** `git status --porcelain=v1 -b -z` */
export function parseStatus(raw: string): GitStatus {
  const parts = raw.split('\0').filter(Boolean)
  const status: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] }
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (p.startsWith('## ')) {
      const m = p.match(/^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/)
      status.branch = m?.[1] === 'HEAD' ? null : (m?.[1] ?? null)
      status.upstream = m?.[2] ?? null
      status.ahead = Number(m?.[3] ?? 0)
      status.behind = Number(m?.[4] ?? 0)
      continue
    }
    const index = p[0]!
    const worktree = p[1]!
    status.files.push({ path: p.slice(3), index, worktree })
    if (index === 'R' || index === 'C') i++ // the next entry is the original path
  }
  return status
}

/** `git log --format=%H%x1f%an%x1f%aI%x1f%s%x1e` */
export function parseLog(raw: string): GitCommit[] {
  return raw
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, author, date, subject] = r.split('\x1f')
      return { hash: hash!, author: author ?? '', date: date ?? '', subject: subject ?? '' }
    })
}

const unquote = (p: string) => p.replace(/^"(.*)"$/, '$1')

/** Unified diff (git diff / git show) into files, hunks and new-file line numbers. */
export function parseDiff(raw: string): { files: DiffFile[]; truncated: boolean } {
  const truncated = raw.includes('\0TRUNCATED\0')
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let newLine = 0
  for (const line of raw.replace('\0TRUNCATED\0', '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/)
      file = { path: unquote(m?.[2] ?? ''), oldPath: null, status: 'modified', binary: false, hunks: [], additions: 0, deletions: 0 }
      files.push(file)
      hunk = null
    } else if (!file) {
      continue
    } else if (line.startsWith('new file mode')) {
      file.status = 'added'
    } else if (line.startsWith('deleted file mode')) {
      file.status = 'deleted'
    } else if (line.startsWith('rename from ')) {
      file.status = 'renamed'
      file.oldPath = line.slice('rename from '.length)
    } else if (line.startsWith('Binary files')) {
      file.binary = true
    } else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      newLine = Number(m?.[1] ?? 1)
      hunk = { newStart: newLine, lines: [] }
      file.hunks.push(hunk)
    } else if (hunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      const type = line[0] as DiffLine['type']
      hunk.lines.push({ type, text: line.slice(1), newLine: type === '-' ? null : newLine })
      if (type !== '-') newLine++
      if (type === '+') file.additions++
      if (type === '-') file.deletions++
    }
  }
  return { files, truncated }
}
