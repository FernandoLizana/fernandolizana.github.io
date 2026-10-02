import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const USER = 'FernandoLizana'
const PER_PAGE = 100
const MAX_PAGES = 20

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function validHomepage(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function normalizeRepo(repo) {
  if (!repo || typeof repo.id !== 'number' || typeof repo.name !== 'string') {
    throw new Error('Repositorio sin id o sin nombre. No se reemplaza el catálogo.')
  }
  if (typeof repo.html_url !== 'string' || !repo.html_url.startsWith(`https://github.com/${USER}/`)) {
    throw new Error(`Enlace inesperado en ${repo.name}. No se reemplaza el catálogo.`)
  }
  return {
    id: repo.id,
    name: repo.name,
    description: typeof repo.description === 'string' && repo.description.trim() ? repo.description.trim() : null,
    language: typeof repo.language === 'string' && repo.language.trim() ? repo.language.trim() : null,
    topics: Array.isArray(repo.topics) ? repo.topics.filter((topic) => typeof topic === 'string') : [],
    stargazersCount: Number.isFinite(repo.stargazers_count) ? repo.stargazers_count : 0,
    forksCount: Number.isFinite(repo.forks_count) ? repo.forks_count : 0,
    fork: Boolean(repo.fork),
    archived: Boolean(repo.archived),
    homepage: validHomepage(repo.homepage),
    htmlUrl: repo.html_url,
    pushedAt: typeof repo.pushed_at === 'string' ? repo.pushed_at : null,
  }
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    throw new Error('La API de GitHub no devolvió JSON. No se reemplaza el catálogo.')
  }
}

async function requestJson(url, { fetchImpl, headers, sleep, attempts = 4 }) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers })
      if (response.status === 403 || response.status === 429) {
        const remaining = response.headers?.get?.('x-ratelimit-remaining')
        throw Object.assign(
          new Error(
            `Límite de la API de GitHub (HTTP ${response.status}${remaining ? `, remaining ${remaining}` : ''}). No se reemplaza el catálogo.`,
          ),
          { permanent: true },
        )
      }
      if (response.status >= 500 || response.status === 408) {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok) {
        throw Object.assign(
          new Error(`Error HTTP ${response.status} al consultar GitHub. No se reemplaza el catálogo.`),
          { permanent: true },
        )
      }
      return readJson(response)
    } catch (error) {
      if (error && error.permanent) throw error
      lastError = error
      if (attempt === attempts) break
      await sleep(350 * attempt)
    }
  }
  const reason = lastError instanceof Error ? lastError.message : 'desconocido'
  throw new Error(`Error de red al consultar GitHub (${reason}). No se reemplaza el catálogo.`)
}

export function validateCatalog(catalog) {
  const errors = []
  if (!catalog || typeof catalog !== 'object') {
    return ['El catálogo no es un objeto.']
  }
  if (catalog.complete !== true) errors.push('El catálogo no está marcado como completo.')
  if (catalog.owner !== USER) errors.push('El propietario del catálogo no es FernandoLizana.')
  if (!Array.isArray(catalog.repos)) errors.push('Falta la lista de repositorios.')
  if (catalog.repos?.length !== catalog.count || catalog.count !== catalog.expectedCount) {
    errors.push('El total no coincide con los repositorios guardados.')
  }
  if (!Number.isInteger(catalog.fetchedCount) || !Number.isInteger(catalog.publicRepos) || catalog.fetchedCount !== catalog.publicRepos) {
    errors.push('La descarga no coincide con el total público del perfil.')
  }
  if (!Number.isInteger(catalog.excludedCount) || catalog.excludedCount < 0) {
    errors.push('El número de repositorios excluidos no es válido.')
  }
  if (catalog.fetchedCount !== catalog.count + catalog.excludedCount) {
    errors.push('Las exclusiones no cuadran con el total descargado.')
  }
  if (!Number.isInteger(catalog.pagesFetched) || catalog.pagesFetched < 1) {
    errors.push('No consta la paginación consultada.')
  }
  if (!catalog.syncedAt || Number.isNaN(Date.parse(catalog.syncedAt))) {
    errors.push('Falta la fecha de sincronización.')
  }
  if (typeof catalog.source !== 'string' || !catalog.source.includes('type=owner') || !catalog.source.includes('per_page=100')) {
    errors.push('La fuente no corresponde al endpoint pedido.')
  }
  const serialized = JSON.stringify(catalog)
  if (/ghp_|github_pat_|Bearer\s+/i.test(serialized)) {
    errors.push('El catálogo contiene algo que parece una credencial.')
  }
  const ids = new Set()
  for (const repo of catalog.repos ?? []) {
    if (typeof repo.id !== 'number' || typeof repo.name !== 'string') {
      errors.push('Repositorio sin id o sin nombre.')
      continue
    }
    if (ids.has(repo.id)) errors.push(`Id duplicado: ${repo.id}.`)
    ids.add(repo.id)
    if (typeof repo.htmlUrl !== 'string' || !repo.htmlUrl.startsWith(`https://github.com/${USER}/`)) {
      errors.push(`Enlace inválido en ${repo.name}.`)
    }
    if (typeof repo.fork !== 'boolean' || typeof repo.archived !== 'boolean') {
      errors.push(`Falta el indicador de fork o archivado en ${repo.name}.`)
    }
    if (!Array.isArray(repo.topics)) errors.push(`Topics inválidos en ${repo.name}.`)
    if (repo.homepage !== null && (typeof repo.homepage !== 'string' || !/^https?:\/\//.test(repo.homepage))) {
      errors.push(`Página de inicio inválida en ${repo.name}.`)
    }
  }
  if (catalog.count === 0 && catalog.fetchedCount !== catalog.excludedCount) {
    errors.push('El catálogo está vacío sin una descarga completa que lo justifique.')
  }
  return errors
}

export async function fetchAllRepos({
  fetchImpl = globalThis.fetch,
  token = '',
  user = USER,
  perPage = PER_PAGE,
  maxPages = MAX_PAGES,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date(),
  excludedNames = [],
} = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'fernando-lizana-universo',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const profile = await requestJson(`https://api.github.com/users/${user}`, {
    fetchImpl,
    headers,
    sleep,
  })
  if (!profile || typeof profile.public_repos !== 'number') {
    throw new Error('No se pudo leer el total de repositorios públicos. No se reemplaza el catálogo.')
  }

  const repos = []
  let pagesFetched = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `https://api.github.com/users/${user}/repos?type=owner&per_page=${perPage}&page=${page}`
    const batch = await requestJson(url, { fetchImpl, headers, sleep })
    if (!Array.isArray(batch)) {
      throw new Error('Una página de repositorios no es una lista. No se reemplaza el catálogo.')
    }
    pagesFetched += 1
    for (const repo of batch) {
      if (repo?.private === true) continue
      repos.push(normalizeRepo(repo))
    }
    if (batch.length < perPage) break
    if (page === maxPages) {
      throw new Error('La paginación se detuvo en el máximo de páginas. No se reemplaza el catálogo.')
    }
  }

  if (repos.length !== profile.public_repos) {
    throw new Error(
      `Descarga incompleta: llegaron ${repos.length} repositorios y el perfil indica ${profile.public_repos}. No se reemplaza el catálogo.`,
    )
  }

  const hidden = new Set(excludedNames)
  const sorted = repos.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const visible = sorted.filter((repo) => !hidden.has(repo.name))
  const catalog = {
    syncedAt: now().toISOString(),
    owner: user,
    source: `https://api.github.com/users/${user}/repos?type=owner&per_page=${perPage}`,
    complete: true,
    count: visible.length,
    expectedCount: visible.length,
    fetchedCount: sorted.length,
    publicRepos: profile.public_repos,
    excludedCount: sorted.length - visible.length,
    pagesFetched,
    repos: visible,
  }
  const errors = validateCatalog(catalog)
  if (errors.length) {
    throw new Error(`${errors.join(' ')} No se reemplaza el catálogo.`)
  }
  return catalog
}

export async function publishCatalog(catalog, dest) {
  const errors = validateCatalog(catalog)
  if (errors.length) {
    throw new Error(`${errors.join(' ')} No se escribe el archivo.`)
  }
  const json = `${JSON.stringify(catalog, null, 2)}\n`
  JSON.parse(json)
  await mkdir(path.dirname(dest), { recursive: true })
  const temporary = `${dest}.tmp`
  await writeFile(temporary, json)
  try {
    await rename(temporary, dest)
  } catch {
    await rm(dest, { force: true })
    await rename(temporary, dest)
  }
}

export async function syncToFile(options) {
  const catalog = await fetchAllRepos(options)
  await publishCatalog(catalog, options.dest)
  return catalog
}

async function loadExcludedNames() {
  const file = path.join(root, 'scripts', 'excluded-repos.json')
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  if (!Array.isArray(parsed.names) || parsed.names.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error('scripts/excluded-repos.json no tiene una lista válida de nombres.')
  }
  return parsed.names
}

async function main() {
  try {
    const dest = path.join(root, 'public', 'catalog.json')
    const excludedNames = await loadExcludedNames()
    const catalog = await syncToFile({
      dest,
      token: process.env.GITHUB_TOKEN || '',
      excludedNames,
    })
    console.log(
      `Catálogo válido: ${catalog.count} proyectos visibles, ${catalog.excludedCount} excluidos, ${catalog.pagesFetched} página(s), sincronizado ${catalog.syncedAt}.`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  await main()
}
