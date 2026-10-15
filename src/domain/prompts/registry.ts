// Prompts live in /prompts as versioned markdown files and are bundled at build time.
const files = import.meta.glob('/prompts/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export interface PromptRef {
  id: string
  version: number
}

export interface RenderedPrompt extends PromptRef {
  text: string
}

const versions = new Map<string, Map<number, string>>()
const roles = new Map<string, string>()

for (const [path, text] of Object.entries(files)) {
  const role = path.match(/^\/prompts\/roles\/([\w-]+)\.md$/)
  if (role) {
    roles.set(role[1]!, text.trim())
    continue
  }
  const m = path.match(/^\/prompts\/([\w-]+)\/v(\d+)\.md$/)
  if (!m) continue
  const byVersion = versions.get(m[1]!) ?? new Map<number, string>()
  byVersion.set(Number(m[2]), text.trim())
  versions.set(m[1]!, byVersion)
}

export function latestVersion(id: string): number {
  const byVersion = versions.get(id)
  if (!byVersion) throw new Error(`unknown prompt: ${id}`)
  return Math.max(...byVersion.keys())
}

/** Renders `{{name}}` placeholders. Unknown or unused variables are errors to catch prompt drift early. */
export function render(id: string, vars: Record<string, string>, version = latestVersion(id)): RenderedPrompt {
  const template = versions.get(id)?.get(version)
  if (template === undefined) throw new Error(`unknown prompt: ${id}@v${version}`)
  const used = new Set<string>()
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = vars[name]
    if (value === undefined) throw new Error(`prompt ${id}@v${version}: missing variable "${name}"`)
    used.add(name)
    return value
  })
  const unused = Object.keys(vars).filter((k) => !used.has(k))
  if (unused.length) throw new Error(`prompt ${id}@v${version}: unused variables ${unused.join(', ')}`)
  return { id, version, text }
}

export function roleBrief(roleId: string): { label: string; brief: string } {
  const text = roles.get(roleId)
  if (!text) throw new Error(`unknown role: ${roleId}`)
  const [heading, ...rest] = text.split('\n')
  return { label: heading!.replace(/^#\s*/, ''), brief: rest.join('\n').trim() }
}

export const roleIds = (): string[] => [...roles.keys()].sort()
