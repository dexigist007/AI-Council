import { describe, expect, it } from 'vitest'
import { chunkText, declarationName } from './chunker'
import { kindOf, languageOf } from './classify'
import { detectStack } from './detect'

describe('classify', () => {
  it('assigns language and kind', () => {
    expect(languageOf('src/App.vue')).toBe('Vue')
    expect(languageOf('Dockerfile')).toBe('Dockerfile')
    expect(languageOf('LICENSE')).toBeNull()
    expect(kindOf('package.json')).toBe('manifest')
    expect(kindOf('app/build.gradle.kts')).toBe('manifest')
    expect(kindOf('src/utils.test.ts')).toBe('test')
    expect(kindOf('app/src/androidTest/Foo.kt')).toBe('test')
    expect(kindOf('README.md')).toBe('doc')
    expect(kindOf('tsconfig.json')).toBe('config')
    expect(kindOf('src/main.rs')).toBe('source')
    expect(kindOf('LICENSE')).toBe('other')
  })
})

describe('chunker', () => {
  it('finds declaration names across languages', () => {
    expect(declarationName('export async function loadPlaylist(url) {')).toBe('loadPlaylist')
    expect(declarationName('  pub fn scan(root: &Path) -> Vec<X> {')).toBe('scan')
    expect(declarationName('class PlayerViewModel : ViewModel() {')).toBe('PlayerViewModel')
    expect(declarationName('    suspend fun fetch() {')).toBe('fetch')
    expect(declarationName('def parse_m3u(text):')).toBe('parse_m3u')
    expect(declarationName('  return x')).toBeNull()
  })

  it('keeps small files whole and splits large files before declarations', () => {
    expect(chunkText('a\nb\n')).toEqual([{ startLine: 1, endLine: 2, symbol: null, content: 'a\nb', tokenEst: 1 }])
    const body = (n: number) => Array.from({ length: n }, (_, i) => `  line${i}`)
    const text = ['function first() {', ...body(99), '}', 'function second() {', ...body(150), '}'].join('\n')
    const chunks = chunkText(text)
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 101, symbol: 'first' })
    expect(chunks[1]).toMatchObject({ startLine: 102, symbol: 'second' })
    // Ranges are contiguous and cover every line.
    expect(chunks.at(-1)!.endLine).toBe(253)
    chunks.slice(1).forEach((c, i) => expect(c.startLine).toBe(chunks[i]!.endLine + 1))
  })

  it('skips whitespace-only chunks and normalises CRLF', () => {
    expect(chunkText('\r\n\r\n')).toEqual([])
    expect(chunkText('x\r\ny').map((c) => c.content)).toEqual(['x\ny'])
  })
})

describe('detectStack', () => {
  it('reads frameworks and services from manifests with file evidence', () => {
    const facts = detectStack([
      { path: 'package.json', content: JSON.stringify({ dependencies: { vue: '^3', firebase: '^10' }, devDependencies: { vite: '^5' } }) },
      { path: 'src-tauri/Cargo.toml', content: '[package]\nname="x"\n[dependencies]\ntauri = "2"\nserde = "1"\n' },
      { path: 'app/build.gradle.kts', content: 'plugins { id("com.android.application"); kotlin("android") }\nimplementation("androidx.media3:media3-exoplayer:1.3")' },
      { path: 'broken/package.json', content: '{ not json' },
    ])
    const names = facts.map((f) => `${f.category}:${f.name}@${f.file}`)
    expect(names).toContain('framework:Vue@package.json')
    expect(names).toContain('service:Firebase@package.json')
    expect(names).toContain('platform:Tauri@src-tauri/Cargo.toml')
    expect(names).toContain('platform:Android@app/build.gradle.kts')
    expect(names).toContain('framework:Media3 / ExoPlayer@app/build.gradle.kts')
    expect(names.filter((n) => n.startsWith('language:Rust'))).toHaveLength(1)
    expect(names.some((n) => n.includes('broken/'))).toBe(false)
  })
})
