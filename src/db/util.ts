export const newId = (): string => crypto.randomUUID()

export const nowIso = (): string => new Date().toISOString()

export const toBool = (v: number): boolean => v === 1

export const fromBool = (v: boolean): number => (v ? 1 : 0)

export function parseJson<T>(text: string | null, fallback: T): T {
  if (text == null) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}
