import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fetchAllRepos, publishCatalog, syncToFile } from './sync-catalog.mjs'

function repo(id, extra = {}) {
  return {
    id,
    name: `repo-${id}`,
    private: false,
    description: id % 2 === 0 ? null : 'Descripción real',
    language: id % 3 === 0 ? null : 'Python',
    topics: id % 2 === 0 ? ['qa'] : [],
    stargazers_count: 0,
    forks_count: 0,
    fork: id % 4 === 0,
    archived: id % 9 === 0,
    homepage: id === 2 ? 'no-es-url' : id === 3 ? 'https://digitalriderspa.com/demo' : '',
    html_url: `https://github.com/FernandoLizana/repo-${id}`,
    pushed_at: '2024-05-06T07:08:09Z',
    ...extra,
  }
}

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}

function api(pages, userCount = pages.flat().length) {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(url)
    if (url === 'https://api.github.com/users/FernandoLizana') {
      return response(200, { public_repos: userCount, login: 'FernandoLizana' })
    }
    const page = Number(new URL(url).searchParams.get('page'))
    assert.match(url, /type=owner/)
    assert.match(url, /per_page=100/)
    return response(200, pages[page - 1] ?? [])
  }
  return { fetchImpl, seen }
}

async function tempFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'universo-'))
  return path.join(dir, 'catalog.json')
}

test('pagina más de 100 repositorios y conserva fork, archivado y homepage', async () => {
  const first = Array.from({ length: 100 }, (_, index) => repo(index + 1))
  const second = Array.from({ length: 3 }, (_, index) => repo(index + 101))
  const { fetchImpl, seen } = api([first, second])
  const catalog = await fetchAllRepos({
    fetchImpl,
    sleep: async () => {},
    now: () => new Date('2026-10-01T12:00:00.000Z'),
    token: 'ghp_esto_no_debe_guardarse',
  })
  assert.equal(catalog.count, 103)
  assert.equal(catalog.expectedCount, 103)
  assert.equal(catalog.fetchedCount, 103)
  assert.equal(catalog.publicRepos, 103)
  assert.equal(catalog.excludedCount, 0)
  assert.equal(catalog.pagesFetched, 2)
  assert.equal(catalog.repos.length, 103)
  assert.equal(catalog.complete, true)
  assert.equal(JSON.stringify(catalog).includes('ghp_'), false)
  assert.equal(catalog.repos.find((item) => item.id === 2).homepage, null)
  assert.equal(catalog.repos.find((item) => item.id === 3).homepage, 'https://digitalriderspa.com/demo')
  assert.equal(catalog.repos.find((item) => item.id === 4).fork, true)
  assert.equal(catalog.repos.find((item) => item.id === 9).archived, true)
  assert.equal(catalog.repos.find((item) => item.id === 3).language, null)
  assert.equal(catalog.repos.find((item) => item.id === 3).stargazersCount, 0)
  assert.equal(seen.filter((url) => url.includes('/repos?')).length, 2)
})

test('una página de red fallida no sustituye el catálogo anterior', async () => {
  const dest = await tempFile()
  const sentinel = `${JSON.stringify({ sentinel: true })}\n`
  await writeFile(dest, sentinel)
  let repoCalls = 0
  const fetchImpl = async (url) => {
    if (url === 'https://api.github.com/users/FernandoLizana') {
      return response(200, { public_repos: 150 })
    }
    repoCalls += 1
    if (repoCalls < 3) throw new Error('socket cerrado')
    return response(500, { message: 'unavailable' })
  }
  await assert.rejects(
    () =>
      syncToFile({
        dest,
        fetchImpl,
        sleep: async () => {},
        token: '',
      }),
    /No se reemplaza el catálogo/,
  )
  assert.equal(await readFile(dest, 'utf8'), sentinel)
  assert.equal(repoCalls, 4)
})

test('un límite de API no publica un catálogo parcial', async () => {
  const dest = await tempFile()
  await writeFile(dest, 'anterior\n')
  const fetchImpl = async () => response(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0' })
  await assert.rejects(
    () => syncToFile({ dest, fetchImpl, sleep: async () => {} }),
    /Límite de la API/,
  )
  assert.equal(await readFile(dest, 'utf8'), 'anterior\n')
})

test('si el total no coincide, se conserva el archivo previo', async () => {
  const dest = await tempFile()
  await writeFile(dest, 'valido\n')
  const { fetchImpl } = api([[repo(1), repo(2)]], 7)
  await assert.rejects(
    () => syncToFile({ dest, fetchImpl, sleep: async () => {} }),
    /Descarga incompleta/,
  )
  assert.equal(await readFile(dest, 'utf8'), 'valido\n')
})

test('publishCatalog rechaza un catálogo vacío o incompleto', async () => {
  const dest = await tempFile()
  await writeFile(dest, 'previo\n')
  await assert.rejects(
    () => publishCatalog({ complete: true, count: 0, expectedCount: 4, repos: [], pagesFetched: 1 }, dest),
    /No se escribe/,
  )
  assert.equal(await readFile(dest, 'utf8'), 'previo\n')
})

test('excluye repositorios privados antes de cerrar el total', async () => {
  const publicRepo = repo(1)
  const privateRepo = repo(2, { private: true, name: 'secreto' })
  const { fetchImpl } = api([[publicRepo, privateRepo]], 1)
  const catalog = await fetchAllRepos({ fetchImpl, sleep: async () => {}, now: () => new Date('2026-10-01T00:00:00.000Z') })
  assert.equal(catalog.count, 1)
  assert.equal(catalog.repos[0].name, 'repo-1')
  assert.equal(JSON.stringify(catalog).includes('secreto'), false)
})

test('deja fuera los repositorios de la lista y no los publica', async () => {
  const pages = [[repo(1, { name: 'Hello-World' }), repo(2, { name: 'observatorio' })]]
  const { fetchImpl } = api(pages, 2)
  const catalog = await fetchAllRepos({
    fetchImpl,
    sleep: async () => {},
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    excludedNames: ['Hello-World', 'ya-no-existe'],
  })
  assert.equal(catalog.fetchedCount, 2)
  assert.equal(catalog.publicRepos, 2)
  assert.equal(catalog.count, 1)
  assert.equal(catalog.excludedCount, 1)
  assert.equal(JSON.stringify(catalog).includes('Hello-World'), false)
  assert.equal(catalog.repos[0].name, 'observatorio')
})
