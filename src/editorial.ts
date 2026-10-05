import type { Repo } from './types.ts'

export type EditorialImage = {
  src: string
  alt: string
}

export type EditorialEntry = {
  does?: string
  points: string[]
  built: string[]
  image?: EditorialImage
}

export type Editorial = {
  featured: string[]
  projects: Record<string, EditorialEntry>
}

export const emptyEditorial: Editorial = { featured: [], projects: {} }

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function cleanImage(value: unknown): EditorialImage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const image = value as { src?: unknown; alt?: unknown }
  if (typeof image.src !== 'string' || typeof image.alt !== 'string') return undefined
  try {
    const url = new URL(image.src)
    if (url.protocol !== 'https:') return undefined
  } catch {
    return undefined
  }
  const alt = image.alt.trim()
  if (!alt) return undefined
  return { src: image.src, alt }
}

export function parseEditorial(data: unknown): Editorial {
  if (!data || typeof data !== 'object') return emptyEditorial
  const source = data as { featured?: unknown; projects?: unknown }
  const featured = Array.isArray(source.featured)
    ? source.featured.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    : []
  const projects: Record<string, EditorialEntry> = {}
  if (source.projects && typeof source.projects === 'object') {
    for (const [name, value] of Object.entries(source.projects)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as { does?: unknown; points?: unknown; built?: unknown; image?: unknown }
      const does = cleanText(entry.does)
      const points = cleanList(entry.points)
      const built = cleanList(entry.built)
      const image = cleanImage(entry.image)
      if (!does && points.length === 0 && built.length === 0 && !image) continue
      projects[name] = { does, points, built, image }
    }
  }
  return { featured, projects }
}

export async function loadEditorial(): Promise<Editorial> {
  try {
    const response = await fetch(new URL('editorial.json', document.baseURI))
    if (!response.ok) return emptyEditorial
    return parseEditorial(await response.json())
  } catch {
    return emptyEditorial
  }
}

export function featuredRepos(repos: Repo[], editorial: Editorial, limit = 16): Repo[] {
  const byName = new Map(repos.map((repo) => [repo.name, repo]))
  const picked: Repo[] = []
  for (const name of editorial.featured) {
    const repo = byName.get(name)
    if (!repo || picked.some((item) => item.id === repo.id)) continue
    picked.push(repo)
    if (picked.length >= limit) break
  }
  return picked
}

export function entryFor(editorial: Editorial, repo: Repo): EditorialEntry | undefined {
  return editorial.projects[repo.name]
}
