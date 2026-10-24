import { t, type MessageKey } from '@/i18n'

const SKIP_REASONS = ['sensitive', 'lockfile', 'binary', 'too_large']

/** Why the indexer did not read a file; unknown reasons are shown as they are. */
export const skipLabel = (reason: string): string =>
  SKIP_REASONS.includes(reason) ? t(`projects.skip.${reason}` as MessageKey) : reason
