import { describe, expect, it } from 'vitest'
import { redact } from './redactor'

describe('redact', () => {
  it('masks known key formats', () => {
    const src = [
      'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      'const k = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
      'aws = AKIAIOSFODNN7EXAMPLE',
      'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
      'maps: AIzaSyA-1234567890abcdefghijklmnopqrstu',
      'stripe sk_live_51HabcdefGHIJKLMNOP',
    ].join('\n')
    const r = redact(src)
    expect(r.text).not.toMatch(/abcdefghijklmnopqrstuvwxyz123456|AAAAAAAAAAAAAAAAAAAAAAAAAAAA|IOSFODNN7|aBcDeFgHiJ|1234567890abcdefghij|HabcdefGHIJ/)
    expect(r.count).toBeGreaterThanOrEqual(6)
  })

  it('masks private keys, URL passwords and secret assignments', () => {
    const r = redact([
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----',
      'DATABASE_URL=postgres://admin:S3cr3tPass@db.example.com:5432/app',
      'password = "hunter2hunter2"',
      "clientSecret: 'q8w7e6r5t4y3'",
    ].join('\n'))
    expect(r.text).toContain('[REDACTED PRIVATE KEY]')
    expect(r.text).toContain('postgres://admin:********@db.example.com')
    expect(r.text).toContain('password = "********"')
    expect(r.text).toContain("clientSecret: '********'")
    expect(r.text).not.toMatch(/MIIEow|S3cr3tPass|hunter2|q8w7e6/)
    expect(r.kinds).toEqual(expect.arrayContaining(['private_key', 'url_credentials', 'assignment']))
  })

  it('leaves code that only references secrets alone', () => {
    const code = [
      'const apiKey = process.env.OPENAI_API_KEY',
      'password: ${DB_PASSWORD}',
      'token = getenv("TOKEN")',
      'API_KEY=your_api_key_here',
      'function resetPassword(user) { return sendToken(user) }',
      'const hash = "0123456789abcdef0123456789abcdef"', // hex: low mixedness, not masked
      'secrets  : keyring (Keychain / Credential Manager)', // prose in docs
    ].join('\n')
    expect(redact(code)).toEqual({ text: code, count: 0, kinds: [] })
  })

  it('masks long random quoted strings', () => {
    const r = redact('const k = "Zx9Qw3Er7Ty1Ui5Op2As8Df4Gh6Jk0Lm"')
    expect(r.text).toBe('const k = "********"')
    expect(r.kinds).toEqual(['high_entropy'])
  })
})
