import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  countLabel,
  initialFilters,
  isHttpUrl,
  matchesRepo,
  parseCatalog,
  visibleRepos,
} from './catalog.ts'
import type { Catalog, Repo } from './types.ts'

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    name: 'leucode',
    description: 'Monitor de servicios',
    language: 'JavaScript',
    topics: ['observabilidad', 'agentes'],
    stargazersCount: 0,
    forksCount: 0,
    fork: false,
    archived: false,
    homepage: null,
    htmlUrl: 'https://github.com/FernandoLizana/leucode',
    pushedAt: '2026-04-11T16:43:43Z',
    ...overrides,
  }
}

function catalog(repos: Repo[]): Catalog {
  return {
    syncedAt: '2026-10-01T04:00:00.000Z',
    owner: 'FernandoLizana',
    source: 'https://api.github.com/users/FernandoLizana/repos?type=owner&per_page=100',
    complete: true,
    count: repos.length,
    expectedCount: repos.length,
    fetchedCount: repos.length,
    publicRepos: repos.length,
    excludedCount: 0,
    pagesFetched: 1,
    repos,
  }
}

test('acepta una URL http o https y rechaza el resto', () => {
  assert.equal(isHttpUrl('https://digitalriderspa.com/'), true)
  assert.equal(isHttpUrl('notaurl'), false)
  assert.equal(isHttpUrl(''), false)
  assert.equal(isHttpUrl(null), false)
})

test('la búsqueda usa nombre, descripción y topics', () => {
  const state = initialFilters([repo()])
  assert.equal(matchesRepo(repo(), { ...state, query: 'leuco' }), true)
  assert.equal(matchesRepo(repo(), { ...state, query: 'servicios' }), true)
  assert.equal(matchesRepo(repo(), { ...state, query: 'observabilidad' }), true)
  assert.equal(matchesRepo(repo(), { ...state, query: 'JavaScript' }), false)
  assert.equal(matchesRepo(repo({ description: 'Código' }), { ...state, query: 'codigo' }), true)
})

test('los filtros de lenguaje, fork y archivado no cambian el total', () => {
  const repos = [
    repo(),
    repo({ id: 2, name: 'exemplos', language: 'Python', fork: true, description: null, topics: [] }),
    repo({ id: 3, name: 'viejo', language: null, archived: true, description: null, topics: [], htmlUrl: 'https://github.com/FernandoLizana/viejo' }),
  ]
  const state = initialFilters(repos)
  assert.equal(visibleRepos(repos, state).length, 3)
  assert.equal(visibleRepos(repos, { ...state, forks: 'only' }).map((item) => item.name).join(), 'exemplos')
  assert.equal(visibleRepos(repos, { ...state, forks: 'hide' }).length, 2)
  assert.equal(visibleRepos(repos, { ...state, archived: 'only' }).length, 1)
  state.languages.delete('Python')
  assert.equal(visibleRepos(repos, state).some((item) => item.name === 'exemplos'), false)
  assert.equal(countLabel(2, 3), '2 visibles · 3 en total')
})

test('un catálogo incompleto no se acepta', () => {
  const broken = catalog([repo()])
  broken.complete = false
  assert.throws(() => parseCatalog(broken), /incompleto/)
  const partial = catalog([repo()])
  partial.expectedCount = 9
  assert.throws(() => parseCatalog(partial), /no coincide/)
})
