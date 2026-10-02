import assert from 'node:assert/strict'
import { test } from 'node:test'
import { featuredRepos, parseEditorial } from './editorial.ts'
import type { Repo } from './types.ts'

function repo(name: string, id: number): Repo {
  return {
    id,
    name,
    description: null,
    language: 'Python',
    topics: [],
    stargazersCount: 0,
    forksCount: 0,
    fork: false,
    archived: false,
    homepage: null,
    htmlUrl: `https://github.com/FernandoLizana/${name}`,
    pushedAt: null,
  }
}

test('un texto editorial solo acompaña a un repositorio que existe', () => {
  const editorial = parseEditorial({
    featured: ['Espectro', 'no-existe', 'limpieza', 'impulso', 'extra'],
    projects: {
      Espectro: { does: 'Escucha el transmisor.', points: ['Dos canales.'], built: ['Python'] },
      'no-existe': { does: 'No debe aparecer.' },
      impulso: { image: { src: 'http://ejemplo.test/a.png', alt: 'insegura' } },
    },
  })
  const visible = featuredRepos(
    [repo('impulso', 3), repo('Espectro', 1), repo('limpieza', 2)],
    editorial,
  )
  assert.deepEqual(
    visible.map((item) => item.name),
    ['Espectro', 'limpieza', 'impulso'],
  )
  assert.equal(editorial.projects.Espectro.does, 'Escucha el transmisor.')
  assert.equal(editorial.projects.impulso, undefined)
})

test('un editorial mal formado no inventa proyectos', () => {
  const editorial = parseEditorial(null)
  assert.deepEqual(featuredRepos([repo('Espectro', 1)], editorial), [])
})
