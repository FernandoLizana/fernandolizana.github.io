import { languageKey } from './groups.ts'
import type { ArchivedFilter, Catalog, FilterState, ForkFilter, Repo } from './types.ts'

const OWNER = 'FernandoLizana'

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function parseCatalog(data: unknown): Catalog {
  if (!data || typeof data !== 'object') {
    throw new Error('El catálogo de proyectos no tiene un formato válido.')
  }
  const catalog = data as Partial<Catalog>
  if (catalog.complete !== true) {
    throw new Error('El catálogo está incompleto y no se muestra como si fuera el universo completo.')
  }
  if (catalog.owner !== OWNER) {
    throw new Error('El catálogo no corresponde a FernandoLizana.')
  }
  if (!Array.isArray(catalog.repos)) {
    throw new Error('El catálogo no incluye la lista de repositorios.')
  }
  if (catalog.repos.length !== catalog.count || catalog.count !== catalog.expectedCount) {
    throw new Error('El total del catálogo no coincide con los repositorios descargados.')
  }
  const excludedCount = catalog.excludedCount
  if (typeof excludedCount !== 'number' || !Number.isInteger(excludedCount) || excludedCount < 0 || catalog.fetchedCount !== catalog.publicRepos) {
    throw new Error('El catálogo no acredita una descarga completa.')
  }
  if (catalog.fetchedCount !== catalog.count + excludedCount) {
    throw new Error('El catálogo no cuadra con los repositorios que quedaron fuera.')
  }
  if (!catalog.syncedAt || Number.isNaN(Date.parse(catalog.syncedAt))) {
    throw new Error('El catálogo no tiene una fecha de sincronización válida.')
  }
  const ids = new Set<number>()
  for (const repo of catalog.repos) {
    if (!repo || typeof repo.id !== 'number' || typeof repo.name !== 'string') {
      throw new Error('Hay un repositorio sin nombre o sin identificador.')
    }
    if (ids.has(repo.id)) throw new Error(`Hay dos entradas para el repositorio ${repo.id}.`)
    ids.add(repo.id)
    if (!isHttpUrl(repo.htmlUrl) || !repo.htmlUrl.startsWith(`https://github.com/${OWNER}/`)) {
      throw new Error(`El repositorio ${repo.name} no tiene un enlace público de GitHub válido.`)
    }
    if (repo.homepage !== null && !isHttpUrl(repo.homepage)) {
      throw new Error(`El repositorio ${repo.name} tiene una página de inicio inválida.`)
    }
    if (!Number.isInteger(repo.fileCount) || repo.fileCount < 0) {
      throw new Error(`El repositorio ${repo.name} no tiene un conteo de archivos válido.`)
    }
  }
  return catalog as Catalog
}

export async function loadCatalog(): Promise<Catalog> {
  const url = new URL('catalog.json', document.baseURI)
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new Error('No se pudo leer el catálogo local de proyectos.')
  }
  if (!response.ok) {
    throw new Error('No se pudo leer el catálogo local de proyectos.')
  }
  return parseCatalog(await response.json())
}

export function languagesIn(repos: Repo[]): string[] {
  const counts = new Map<string, number>()
  for (const repo of repos) {
    const key = languageKey(repo.language)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .map(([language]) => language)
}

export function matchesRepo(repo: Repo, state: FilterState): boolean {
  if (!state.languages.has(languageKey(repo.language))) return false
  if (state.forks === 'only' && !repo.fork) return false
  if (state.forks === 'hide' && repo.fork) return false
  if (state.archived === 'only' && !repo.archived) return false
  if (state.archived === 'hide' && repo.archived) return false
  const query = normalizeSearch(state.query)
  if (!query) return true
  const haystack = normalizeSearch([repo.name, repo.description ?? '', ...repo.topics].join(' '))
  return haystack.includes(query)
}

export function visibleRepos(repos: Repo[], state: FilterState): Repo[] {
  return repos.filter((repo) => matchesRepo(repo, state))
}

export function initialFilters(repos: Repo[]): FilterState {
  return {
    query: '',
    languages: new Set(languagesIn(repos)),
    forks: 'all',
    archived: 'all',
  }
}

export function countLabel(visible: number, total: number): string {
  const visibleText = visible === 1 ? '1 visible' : `${visible} visibles`
  const totalText = total === 1 ? '1 en total' : `${total} en total`
  return `${visibleText} · ${totalText}`
}

export function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const formatted = new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)
  return `${formatted} UTC`
}

export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(date)
}

export function plural(count: number, singular: string, pluralLabel: string): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`
}

export function isForkFilter(value: string): value is ForkFilter {
  return value === 'all' || value === 'only' || value === 'hide'
}

export function isArchivedFilter(value: string): value is ArchivedFilter {
  return value === 'all' || value === 'only' || value === 'hide'
}
