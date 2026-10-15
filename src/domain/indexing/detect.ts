/** What the manifests say about the stack. Every item names the file it came from (OBSERVED facts). */
export interface StackFact {
  category: 'language' | 'framework' | 'platform' | 'database' | 'service' | 'tooling'
  name: string
  file: string
}

/** Dependency name (or prefix ending in "/") → what it tells us. */
const KNOWN_DEPS: Record<string, [StackFact['category'], string]> = {
  vue: ['framework', 'Vue'], react: ['framework', 'React'], 'react-native': ['platform', 'React Native'],
  next: ['framework', 'Next.js'], nuxt: ['framework', 'Nuxt'], quasar: ['framework', 'Quasar'],
  svelte: ['framework', 'Svelte'], '@angular/core': ['framework', 'Angular'], electron: ['platform', 'Electron'],
  '@tauri-apps/api': ['platform', 'Tauri'], '@capacitor/core': ['platform', 'Capacitor'], express: ['framework', 'Express'],
  '@nestjs/core': ['framework', 'NestJS'], fastify: ['framework', 'Fastify'], vite: ['tooling', 'Vite'],
  webpack: ['tooling', 'webpack'], typescript: ['language', 'TypeScript'], firebase: ['service', 'Firebase'],
  'firebase-admin': ['service', 'Firebase'], '@supabase/supabase-js': ['service', 'Supabase'], stripe: ['service', 'Stripe'],
  prisma: ['database', 'Prisma'], '@prisma/client': ['database', 'Prisma'], mongoose: ['database', 'MongoDB'],
  pg: ['database', 'PostgreSQL'], mysql2: ['database', 'MySQL'], 'better-sqlite3': ['database', 'SQLite'],
  redis: ['database', 'Redis'], 'socket.io': ['framework', 'Socket.IO'], tailwindcss: ['tooling', 'Tailwind CSS'],
  vitest: ['tooling', 'Vitest'], jest: ['tooling', 'Jest'], 'video.js': ['framework', 'Video.js'], 'hls.js': ['framework', 'hls.js'],
  'shaka-player': ['framework', 'Shaka Player'],
  // Rust
  tauri: ['platform', 'Tauri'], tokio: ['framework', 'Tokio'], axum: ['framework', 'Axum'], 'actix-web': ['framework', 'Actix Web'],
  sqlx: ['database', 'SQLx'], rusqlite: ['database', 'SQLite'], diesel: ['database', 'Diesel'],
  // Python
  django: ['framework', 'Django'], flask: ['framework', 'Flask'], fastapi: ['framework', 'FastAPI'], sqlalchemy: ['database', 'SQLAlchemy'],
  pandas: ['framework', 'pandas'], torch: ['framework', 'PyTorch'],
  // PHP / Dart
  'laravel/framework': ['framework', 'Laravel'], 'symfony/symfony': ['framework', 'Symfony'], flutter: ['platform', 'Flutter'],
}

function depFacts(deps: string[], file: string): StackFact[] {
  return deps.flatMap((d) => {
    const hit = KNOWN_DEPS[d.toLowerCase()]
    return hit ? [{ category: hit[0], name: hit[1], file }] : []
  })
}

const tomlDeps = (text: string, section: RegExp) => {
  const out: string[] = []
  let inSection = false
  for (const line of text.split('\n')) {
    const header = line.match(/^\s*\[(.+)]\s*$/)
    if (header) inSection = section.test(header[1]!)
    else if (inSection) {
      const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/)
      if (m) out.push(m[1]!)
    }
  }
  return out
}

/** Parses known manifest files. Unknown or malformed files contribute nothing rather than guesses. */
export function detectStack(files: { path: string; content: string }[]): StackFact[] {
  const facts: StackFact[] = []
  for (const { path, content } of files) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    try {
      if (name === 'package.json') {
        const pkg = JSON.parse(content) as Record<string, Record<string, string> | undefined>
        facts.push({ category: 'language', name: 'JavaScript/TypeScript', file: path })
        facts.push(...depFacts(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }), path))
      } else if (name === 'Cargo.toml') {
        facts.push({ category: 'language', name: 'Rust', file: path })
        facts.push(...depFacts(tomlDeps(content, /dependencies$/), path))
      } else if (name === 'pyproject.toml' || name === 'requirements.txt' || name === 'Pipfile') {
        facts.push({ category: 'language', name: 'Python', file: path })
        const deps = name === 'requirements.txt'
          ? content.split('\n').map((l) => l.trim().split(/[<>=~![ ;]/)[0]!).filter(Boolean)
          : [...content.matchAll(/^\s*"?([A-Za-z0-9_.-]+)/gm)].map((m) => m[1]!)
        facts.push(...depFacts(deps, path))
      } else if (name === 'composer.json') {
        const c = JSON.parse(content) as { require?: Record<string, string> }
        facts.push({ category: 'language', name: 'PHP', file: path }, ...depFacts(Object.keys(c.require ?? {}), path))
      } else if (name === 'pubspec.yaml') {
        facts.push({ category: 'language', name: 'Dart', file: path })
        if (/^\s*flutter:/m.test(content)) facts.push({ category: 'platform', name: 'Flutter', file: path })
      } else if (name === 'go.mod') {
        facts.push({ category: 'language', name: 'Go', file: path })
      } else if (name === 'Gemfile') {
        facts.push({ category: 'language', name: 'Ruby', file: path })
        if (/gem\s+['"]rails['"]/.test(content)) facts.push({ category: 'framework', name: 'Rails', file: path })
      } else if (name.startsWith('build.gradle')) {
        if (/com\.android\.(application|library)/.test(content)) facts.push({ category: 'platform', name: 'Android', file: path })
        if (/kotlin/i.test(content)) facts.push({ category: 'language', name: 'Kotlin', file: path })
        if (/compose/i.test(content)) facts.push({ category: 'framework', name: 'Jetpack Compose', file: path })
        if (/firebase/i.test(content)) facts.push({ category: 'service', name: 'Firebase', file: path })
        if (/room-runtime|androidx\.room/.test(content)) facts.push({ category: 'database', name: 'Room (SQLite)', file: path })
        if (/media3|exoplayer/i.test(content)) facts.push({ category: 'framework', name: 'Media3 / ExoPlayer', file: path })
      } else if (name === 'pom.xml') {
        facts.push({ category: 'language', name: 'Java', file: path })
        if (/spring-boot/.test(content)) facts.push({ category: 'framework', name: 'Spring Boot', file: path })
      } else if (name === 'Podfile' || name === 'Package.swift') {
        facts.push({ category: 'platform', name: 'iOS / Apple', file: path })
      } else if (name.endsWith('.csproj')) {
        facts.push({ category: 'language', name: 'C#', file: path })
      } else if (name === 'tauri.conf.json') {
        facts.push({ category: 'platform', name: 'Tauri', file: path })
      }
    } catch {
      // Malformed manifest: say nothing rather than guess.
    }
  }
  // One fact per (category, name); keep the first file as evidence.
  const seen = new Set<string>()
  return facts.filter((f) => {
    const key = `${f.category}:${f.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
