import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildStarLayout, constellationPairs, frameHome, planetRadius, repoPosition, sectorAngle } from './groups.ts'

test('el radio del planeta es proporcional a sus archivos', () => {
  assert.equal(planetRadius(40, 80), planetRadius(20, 80) * 2)
  assert.equal(planetRadius(80, 80), 9)
  assert.equal(planetRadius(0, 80), 0)
  assert.equal(planetRadius(12, 0), 0)
})

test('la posición depende solo del id y del lenguaje', () => {
  const first = repoPosition(1207539070, 'JavaScript')
  const second = repoPosition(1207539070, 'JavaScript')
  assert.deepEqual(first, second)
  assert.notDeepEqual(repoPosition(1207539070, 'JavaScript'), repoPosition(1207539070, 'HTML'))
  assert.notDeepEqual(repoPosition(1, 'Python'), repoPosition(2, 'Python'))
})

test('cada repositorio produce una estrella', () => {
  const repos = Array.from({ length: 103 }, (_, index) => ({
    id: index + 1,
    name: `repo-${index + 1}`,
    language: index % 2 === 0 ? 'HTML' : null,
    fork: index % 5 === 0,
    archived: index % 11 === 0,
  }))
  const stars = buildStarLayout(repos)
  assert.equal(stars.length, 103)
  assert.equal(new Set(stars.map((star) => star.id)).size, 103)
  assert.equal(stars.filter((star) => star.language === 'Sin lenguaje').length, 51)
})

test('los lenguajes actuales quedan en sectores separados', () => {
  const languages = ['HTML', 'Python', 'JavaScript', 'Sin lenguaje']
  const angles = languages.map((language) => sectorAngle(language))
  for (let i = 0; i < angles.length; i += 1) {
    for (let j = i + 1; j < angles.length; j += 1) {
      const delta = Math.abs(angles[i] - angles[j])
      const separation = Math.min(delta, Math.PI * 2 - delta)
      assert.ok(separation > 0.6, `${languages[i]} y ${languages[j]} quedan demasiado cerca`)
    }
  }
})

test('las líneas forman una constelación y no una malla completa', () => {
  const stars = buildStarLayout([
    { id: 1, name: 'a', language: 'HTML', fork: false, archived: false },
    { id: 2, name: 'b', language: 'HTML', fork: false, archived: false },
    { id: 3, name: 'c', language: 'HTML', fork: true, archived: false },
    { id: 4, name: 'd', language: 'Python', fork: false, archived: false },
  ]).map((star) => ({ ...star, visible: star.id !== 2 }))
  const pairs = constellationPairs(stars)
  const htmlPairs = pairs.filter((pair) => pair.language === 'HTML')
  assert.equal(htmlPairs.length, 1)
  assert.equal(pairs.filter((pair) => pair.language === 'Python').length, 0)
  assert.ok(htmlPairs.every((pair) => pair.a !== 2 && pair.b !== 2))
})

test('la cámara se centra en las estrellas reales', () => {
  const positions = [
    repoPosition(1400902908, 'Python'),
    repoPosition(1400968376, 'Java'),
    repoPosition(1399164453, 'Python'),
  ]
  const frame = frameHome(positions)
  const xs = positions.map((point) => point.x)
  assert.ok(frame.target.x >= Math.min(...xs) - 0.001)
  assert.ok(frame.target.x <= Math.max(...xs) + 0.001)
  assert.ok(frame.position.z > frame.target.z)
  assert.deepEqual(repoPosition(1400902908, 'Python'), positions[0])
})

test('ocultar una estrella no mueve a las demás', () => {
  const before = repoPosition(83246497, 'Python')
  const after = repoPosition(83246497, 'Python')
  assert.deepEqual(before, after)
})
