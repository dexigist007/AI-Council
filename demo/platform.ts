// Demo only: replaces src/platform/tauri.ts. No keychain, no network, no file system.
import type { Transport } from '@/domain/providers/types'

const DEMO_KEYS = new Set(['gemini', 'groq', 'openrouter', 'cerebras'])

export const secrets = {
  set: async (_provider: string, _key: string) => {},
  delete: async (_provider: string) => {},
  exists: async (provider: string) => DEMO_KEYS.has(provider),
}

export const tauriTransport: Transport = async () => {
  throw new Error('Demo mode: no network access')
}

export interface ScanEntry { path: string; size: number; mtimeMs: number; skip: 'sensitive' | 'lockfile' | 'binary' | 'too_large' | null }
export interface FileContent { path: string; content: string | null; error: string | null }

export const projectsFs = {
  pickFolder: async () => null as string | null,
  forgetRoot: async (_root: string) => {},
  defaultExcludes: async () => ['node_modules', 'build', '.gradle', 'dist'],
  scan: async (_root: string, _excludes: string[]) => ({ entries: [] as ScanEntry[], truncated: false }),
  readFiles: async (_root: string, paths: string[]) => paths.map((path) => ({ path, content: null, error: 'demo' })) as FileContent[],
}

export type GitOp =
  | { op: 'status' }
  | { op: 'log'; limit: number }
  | { op: 'diffWorking'; context: number }
  | { op: 'diffCommit'; hash: string; context: number }

export const gitRun = async (_root: string, op: GitOp): Promise<string> => {
  if (op.op === 'status') return '## main...origin/main [ahead 2]\0 M app/src/main/java/net/pocket/sync/RecipeSync.kt\0?? app/src/test/ListMergerTest.kt\0'
  if (op.op === 'log') {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    return [
      ['a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', 'Demo', day(0), 'Move recipe sync off the main thread'],
      ['b2c3d4e5f60718293a4b5c6d7e8f901234567890', 'Demo', day(1), 'Add shopping list merge'],
    ].map((c) => c.join('\x1f')).join('\x1e') + '\x1e'
  }
  return ''
}
