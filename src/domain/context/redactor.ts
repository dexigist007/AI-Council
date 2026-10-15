/**
 * Masks likely secrets before any text leaves the machine. Errs on the side of masking:
 * a false positive costs the model a few characters of context, a miss leaks a credential.
 */
export interface RedactionResult {
  text: string
  count: number
  kinds: string[]
}

const MASK = '********'

interface Rule {
  kind: string
  pattern: RegExp
  replace: (match: string, ...groups: string[]) => string
}

const RULES: Rule[] = [
  {
    kind: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replace: () => '[REDACTED PRIVATE KEY]',
  },
  { kind: 'anthropic_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, replace: () => `sk-ant-${MASK}` },
  { kind: 'openai_key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, replace: () => `sk-${MASK}` },
  { kind: 'aws_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => `AKIA${MASK}` },
  { kind: 'github_token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, replace: () => `gh_${MASK}` },
  { kind: 'google_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => `AIza${MASK}` },
  { kind: 'stripe_key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/g, replace: (m) => `${m.slice(0, 8)}${MASK}` },
  { kind: 'slack_token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: () => `xox-${MASK}` },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replace: () => `jwt.${MASK}` },
  {
    // scheme://user:password@host → keep the user and host, hide the password.
    kind: 'url_credentials',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+):([^@\s/]+)@/gi,
    replace: (_m, prefix) => `${prefix}:${MASK}@`,
  },
  {
    // password = "...", API_KEY: '...', clientSecret="..." (value of 6+ chars, not a placeholder or variable).
    kind: 'assignment',
    // The secret word must end the name (access_token, clientSecret, DB_PASSWORD) and be singular,
    // so max_tokens / tokenEst / secrets:: do not match; "::" is a path separator, not an assignment.
    pattern: /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key|credential))(?![A-Za-z0-9_])(["']?\s*(?:=(?!=)|(?<!:):(?!:))\s*)(["']?)([^"'\s,;(){}]{6,})\3/gi,
    replace: (m, name, sep, quote, value) =>
      // Unquoted plain words are prose or config names ("secrets: keyring"), not credentials.
      (!quote && /^[A-Za-z]+$/.test(value)) ||
      // Unquoted member access or identifiers are code (r.max_tokens, excluded.token, myToken), not values.
      (!quote && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value) && !/\d/.test(value)) ||
      value.includes(MASK) || // already masked by a more specific rule
      /^(?:\$\{?|process\.env|os\.environ|env\(|getenv|import\.meta|<|\*{3,}|x{4,}|your[_-]|changeme|example|placeholder|true|false|null|undefined)/i.test(value)
        ? m
        : `${name}${sep}${quote}${MASK}${quote}`,
  },
]

/** Shannon entropy in bits per character. */
function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

/** Long random-looking quoted strings (keys pasted without a telling variable name). */
const HIGH_ENTROPY = /(["'`])([A-Za-z0-9+/=_-]{32,})\1/g

export function redact(input: string): RedactionResult {
  let text = input
  let count = 0
  const kinds = new Set<string>()
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (...args: string[]) => {
      const replaced = rule.replace(...(args as [string, ...string[]]))
      if (replaced !== args[0]) {
        count++
        kinds.add(rule.kind)
      }
      return replaced
    })
  }
  text = text.replace(HIGH_ENTROPY, (m, quote: string, value: string) => {
    const mixed = /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)
    if (!mixed || entropy(value) < 4.2 || value.includes(MASK)) return m
    count++
    kinds.add('high_entropy')
    return `${quote}${MASK}${quote}`
  })
  return { text, count, kinds: [...kinds] }
}
