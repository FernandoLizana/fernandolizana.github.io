import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCatalog } from './sync-catalog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'public', 'catalog.json')

try {
  const raw = await readFile(dest, 'utf8')
  const catalog = JSON.parse(raw)
  const errors = validateCatalog(catalog)
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log(`Catálogo listo para publicar: ${catalog.count} repositorios, sincronizado ${catalog.syncedAt}.`)
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? `No hay un catálogo válido para publicar (${error.message}).`
      : 'No hay un catálogo válido para publicar.',
  )
  process.exitCode = 1
}
