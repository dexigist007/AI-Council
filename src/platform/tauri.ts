// Every invoke() call lives here so the rest of the app stays testable without Tauri.
import { Channel, invoke } from '@tauri-apps/api/core'
import { CancelledError, type Transport, type TransportRequest, type TransportResponse } from '@/domain/providers/types'

export const secrets = {
  set: (provider: string, key: string) => invoke<void>('secret_set', { provider, key }),
  delete: (provider: string) => invoke<void>('secret_delete', { provider }),
  exists: (provider: string) => invoke<boolean>('secret_exists', { provider }),
}

type StreamEvent = { type: 'data'; data: string }

export const tauriTransport: Transport = async (
  req: TransportRequest,
  onData?: (data: string) => void,
  signal?: AbortSignal,
): Promise<TransportResponse> => {
  if (signal?.aborted) throw new CancelledError()
  const channel = new Channel<StreamEvent>()
  channel.onmessage = (ev) => onData?.(ev.data)
  const requestId = signal ? crypto.randomUUID() : null
  const cancel = () => void invoke('ai_cancel', { requestId })
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    return await invoke<TransportResponse>('ai_request', { req: { ...req, requestId }, onEvent: channel })
  } catch (e) {
    if (e === 'cancelled') throw new CancelledError()
    throw e
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

export interface ScanEntry {
  path: string
  size: number
  mtimeMs: number
  skip: 'sensitive' | 'lockfile' | 'binary' | 'too_large' | null
}

export interface FileContent {
  path: string
  content: string | null
  error: string | null
}

export const projectsFs = {
  /** Native folder picker; registers the folder as readable. Null when cancelled. */
  pickFolder: () => invoke<string | null>('project_pick_folder'),
  forgetRoot: (root: string) => invoke<void>('project_forget_root', { root }),
  defaultExcludes: () => invoke<string[]>('project_default_excludes'),
  scan: (root: string, excludes: string[]) =>
    invoke<{ entries: ScanEntry[]; truncated: boolean }>('project_scan', { root, excludes }),
  readFiles: (root: string, paths: string[]) => invoke<FileContent[]>('project_read_files', { req: { root, paths } }),
}
