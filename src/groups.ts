import type { StarLayout, Vec3 } from './types.ts'

const NAMED_COLORS: Record<string, string> = {
  JavaScript: '#ffd27a',
  TypeScript: '#8eb6ff',
  HTML: '#5ad7ff',
  CSS: '#d2b6ff',
  Python: '#c3b4ff',
  Java: '#8ec9c4',
  'Sin lenguaje': '#f4ecdf',
}

const EXTRA_COLORS = ['#7ee0c8', '#ffb4a2', '#f2a6ff', '#e7f08a', '#9ad1ff', '#ffc1dc']

const NAMED_SECTORS: Record<string, number> = {
  HTML: 0.55,
  CSS: 1.35,
  Python: 2.2,
  Java: 3.15,
  JavaScript: 3.9,
  TypeScript: 5.05,
  'Sin lenguaje': 5.8,
}

export function languageKey(language: string | null | undefined): string {
  if (typeof language !== 'string') return 'Sin lenguaje'
  const trimmed = language.trim()
  return trimmed || 'Sin lenguaje'
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let next = Math.imul(state ^ (state >>> 15), 1 | state)
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromId(id: number): number {
  const low = id >>> 0
  const high = Math.floor(Math.abs(id) / 4294967296) >>> 0
  return (low ^ Math.imul(high, 0x9e3779b1)) >>> 0
}

export function colorForLanguage(language: string): string {
  const named = NAMED_COLORS[language]
  if (named) return named
  return EXTRA_COLORS[hashString(language) % EXTRA_COLORS.length]
}

export function sectorAngle(language: string): number {
  const named = NAMED_SECTORS[language]
  if (named !== undefined) return named
  const golden = 2.399963229728653
  return ((hashString(language) % 997) * golden) % (Math.PI * 2)
}

/**
 * Posición estable: solo depende del id del repositorio y de su lenguaje.
 * Filtrar, buscar o recargar no la recalcula a partir del conjunto visible.
 */
export function repoPosition(id: number, language: string | null | undefined): Vec3 {
  const key = languageKey(language)
  const wedge = 0.72
  const local = mulberry32(seedFromId(id) ^ hashString(`star:${key}`))
  const along = local()
  const angle = sectorAngle(key) + (local() - 0.5) * wedge
  const radius = 14 + along * 28
  const tangential = (local() - 0.5) * 5
  const y = (local() - 0.5) * 8 * (0.45 + along * 0.55)
  return {
    x: Math.cos(angle) * radius - Math.sin(angle) * tangential,
    y,
    z: Math.sin(angle) * radius + Math.cos(angle) * tangential,
  }
}

/** Encuadra la cámara sobre las estrellas reales, sin moverlas. */
export function frameHome(positions: Vec3[]): { position: Vec3; target: Vec3 } {
  if (!positions.length) {
    return { position: { x: 0, y: 18, z: 64 }, target: { x: 0, y: 0, z: 0 } }
  }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of positions) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }
  const target = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 22)
  const distance = span * 1.15 + 36
  return {
    target,
    position: {
      x: target.x + distance * 0.16,
      y: target.y + distance * 0.62,
      z: target.z + distance * 1.08,
    },
  }
}

/**
 * Radio visual del planeta. Es proporcional a sus archivos:
 * el repositorio con más archivos del conjunto usa maxRadius y el resto queda en la misma razón.
 */
export function planetRadius(fileCount: number, maxFileCount: number, maxRadius = 9): number {
  if (!Number.isFinite(fileCount) || fileCount <= 0) return 0
  if (!Number.isFinite(maxFileCount) || maxFileCount <= 0) return 0
  return maxRadius * (fileCount / maxFileCount)
}

export function buildStarLayout(
  repos: { id: number; name: string; language: string | null; fork: boolean; archived: boolean }[],
): StarLayout[] {
  const ids = new Set<number>()
  return repos.map((repo) => {
    if (ids.has(repo.id)) {
      throw new Error(`id de repositorio duplicado: ${repo.id}`)
    }
    ids.add(repo.id)
    return {
      id: repo.id,
      name: repo.name,
      language: languageKey(repo.language),
      fork: repo.fork,
      archived: repo.archived,
      position: repoPosition(repo.id, repo.language),
    }
  })
}

type Point = { x: number; y: number; z: number }

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function minimumSpanningPairs(points: Point[]): Array<[number, number]> {
  if (points.length < 2) return []
  const inTree = new Set<number>([0])
  const pairs: Array<[number, number]> = []
  while (inTree.size < points.length) {
    let best = Number.POSITIVE_INFINITY
    let from = -1
    let to = -1
    for (const inside of inTree) {
      for (let outside = 0; outside < points.length; outside += 1) {
        if (inTree.has(outside)) continue
        const distance = distanceSquared(points[inside], points[outside])
        const closer = distance < best
        const tie = distance === best && (outside < to || (outside === to && inside < from))
        if (closer || tie) {
          best = distance
          from = inside
          to = outside
        }
      }
    }
    if (to < 0) break
    inTree.add(to)
    pairs.push([from, to])
  }
  return pairs
}

export type ConstellationPair = {
  a: number
  b: number
  language: string
}

/** Une estrellas del mismo lenguaje. El trazo indica agrupación, no una dependencia. */
export function constellationPairs(
  stars: Array<StarLayout & { visible: boolean }>,
): ConstellationPair[] {
  const groups = new Map<string, StarLayout[]>()
  for (const star of stars) {
    if (!star.visible) continue
    const group = groups.get(star.language) ?? []
    group.push(star)
    groups.set(star.language, group)
  }
  const pairs: ConstellationPair[] = []
  for (const [language, group] of groups) {
    const links = minimumSpanningPairs(group.map((star) => star.position))
    for (const [from, to] of links) {
      pairs.push({ a: group[from].id, b: group[to].id, language })
    }
  }
  return pairs
}
