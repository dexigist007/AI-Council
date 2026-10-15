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
