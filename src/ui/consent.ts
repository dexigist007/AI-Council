import { Dialog } from 'quasar'
import ConsentDialog from '@/components/ConsentDialog.vue'
import { grantConsent, missingConsent } from '@/domain/consent'
import type { ProviderId } from '@/domain/providers/types'

/** Asks once per cloud provider before data is sent to it. Resolves false if the user declines. */
export async function ensureConsent(ids: ProviderId[]): Promise<boolean> {
  const missing = await missingConsent(ids)
  if (!missing.length) return true
  const ok = await new Promise<boolean>((resolve) => {
    Dialog.create({ component: ConsentDialog, componentProps: { providers: missing } })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false))
  })
  if (ok) await grantConsent(missing)
  return ok
}
