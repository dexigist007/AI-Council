const LANG_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  vue: 'Vue', svelte: 'Svelte', html: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
  py: 'Python', rb: 'Ruby', php: 'PHP', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin',
  swift: 'Swift', m: 'Objective-C', mm: 'Objective-C', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++',
  cs: 'C#', dart: 'Dart', scala: 'Scala', sh: 'Shell', bash: 'Shell', ps1: 'PowerShell', sql: 'SQL',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML', gradle: 'Gradle', md: 'Markdown',
  mdx: 'Markdown', txt: 'Text', lua: 'Lua', r: 'R', ex: 'Elixir', exs: 'Elixir', graphql: 'GraphQL', proto: 'Protobuf',
}

const MANIFESTS = new Set([
  'package.json', 'Cargo.toml', 'go.mod', 'composer.json', 'pubspec.yaml', 'requirements.txt', 'pyproject.toml',
  'Pipfile', 'Gemfile', 'Podfile', 'Package.swift', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
  'settings.gradle.kts', 'pom.xml', 'tauri.conf.json', 'AndroidManifest.xml',
])

export type FileKind = 'source' | 'test' | 'config' | 'doc' | 'manifest' | 'other'

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const extOf = (path: string) => {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function languageOf(path: string): string | null {
  if (basename(path) === 'Dockerfile') return 'Dockerfile'
  if (path.endsWith('.csproj')) return 'XML'
  return LANG_BY_EXT[extOf(path)] ?? null
}

export const isManifest = (path: string) => MANIFESTS.has(basename(path)) || path.endsWith('.csproj')

export function kindOf(path: string): FileKind {
  const name = basename(path).toLowerCase()
  const ext = extOf(path)
  if (isManifest(path)) return 'manifest'
  if (/(^|\/)(tests?|__tests__|spec|androidTest)\//i.test(path) || /[._-](test|spec)\.[a-z]+$/.test(name)) return 'test'
  if (['md', 'mdx', 'txt', 'rst', 'adoc'].includes(ext) || name.startsWith('readme') || name.startsWith('changelog')) return 'doc'
  if (['json', 'yaml', 'yml', 'toml', 'ini', 'xml', 'properties', 'conf', 'cfg', 'env'].includes(ext) || name.startsWith('.') || name === 'dockerfile') return 'config'
  return languageOf(path) ? 'source' : 'other'
}
