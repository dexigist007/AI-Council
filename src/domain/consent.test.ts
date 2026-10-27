import { describe, expect, it, vi } from 'vitest'
import { createTestDb } from '@/db/testing'
import { settingsRepo } from '@/db/repositories/settings'

const settings = settingsRepo(createTestDb())
vi.mock('@/db', () => ({ repos: async () => ({ settings }) }))

const { assertConsent, clearConsents, ConsentRequiredError, grantConsent, missingConsent, revokeConsent } = await import('./consent')

describe('AI data consent', () => {
  it('asks once per cloud provider, never for local servers, and can be withdrawn', async () => {
    expect(await missingConsent(['gemini', 'groq', 'ollama', 'gemini'])).toEqual(['gemini', 'groq'])
    await grantConsent(['gemini'])
    expect(await missingConsent(['gemini', 'groq'])).toEqual(['groq'])
    expect(await settings.get('ai_consent')).toHaveProperty('gemini')
    await expect(assertConsent('groq')).rejects.toBeInstanceOf(ConsentRequiredError)
    await expect(assertConsent('gemini')).resolves.toBeUndefined()
    await expect(assertConsent('lmstudio')).resolves.toBeUndefined()
    await revokeConsent('gemini')
    expect(await missingConsent(['gemini'])).toEqual(['gemini'])
    await grantConsent(['groq'])
    await clearConsents()
    expect(await missingConsent(['groq'])).toEqual(['groq'])
  })
})
