// Every invoke() call lives here so the rest of the app stays testable without Tauri.
import { Channel, invoke } from '@tauri-apps/api/core'
import type { Transport, TransportRequest, TransportResponse } from '@/domain/providers/types'

export const secrets = {
  set: (provider: string, key: string) => invoke<void>('secret_set', { provider, key }),
  delete: (provider: string) => invoke<void>('secret_delete', { provider }),
  exists: (provider: string) => invoke<boolean>('secret_exists', { provider }),
}

type StreamEvent = { type: 'data'; data: string }

export const tauriTransport: Transport = async (
  req: TransportRequest,
  onData?: (data: string) => void,
): Promise<TransportResponse> => {
  const channel = new Channel<StreamEvent>()
  channel.onmessage = (ev) => onData?.(ev.data)
  return invoke<TransportResponse>('ai_request', { req, onEvent: channel })
}
