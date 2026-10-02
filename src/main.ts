import { loadCatalog } from './catalog.ts'
import { loadEditorial } from './editorial.ts'
import { createScene, type SceneController } from './scene.ts'
import { mountUi, preferredMotion, storeMotion } from './ui.ts'

function cameraMotion(ambient: boolean): boolean {
  if (ambient) return true
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>('#galaxy')
  const note = document.querySelector<HTMLParagraphElement>('#fallback-note')
  const list = document.querySelector<HTMLElement>('#lista')
  if (!canvas || !note || !list) return

  let catalog
  try {
    catalog = await loadCatalog()
  } catch (error) {
    canvas.hidden = true
    list.hidden = false
    note.hidden = false
    note.textContent =
      error instanceof Error
        ? error.message
        : 'No se pudo cargar el catálogo de proyectos. No se muestra una galaxia vacía.'
    return
  }

  const editorial = await loadEditorial()
  let ambient = preferredMotion()
  let scene: SceneController | null = null
  const startList = new URLSearchParams(location.search).get('vista') === 'lista'

  const ui = mountUi({
    catalog,
    editorial,
    motion: ambient,
    startList,
    handlers: {
      onFilters(ids) {
        scene?.setVisible(ids)
      },
      onSelect(id) {
        scene?.setPaused(false)
        scene?.focus(id, cameraMotion(ambient))
      },
      onCloseDetail() {
        scene?.clearSelection()
      },
      onReset() {
        ui.closeDetail()
        scene?.resetView(cameraMotion(ambient))
      },
      onView(view) {
        const url = new URL(location.href)
        if (view === 'list') {
          url.searchParams.set('vista', 'lista')
          scene?.setPaused(true)
        } else {
          url.searchParams.delete('vista')
          scene?.setPaused(false)
        }
        history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      },
      onMotion(enabled) {
        ambient = enabled
        storeMotion(enabled)
        scene?.setMotion(enabled)
      },
    },
  })

  try {
    scene = createScene({
      canvas,
      repos: catalog.repos,
      featuredIds: ui.featuredIds(),
      motion: ambient,
      onHover: (hit) => ui.hover(hit),
      onSelect: (id) => ui.select(id),
      onLabels: (labels) => ui.placeLabels(labels),
      onContextLost: () => {
        scene?.setPaused(true)
        ui.forceList('Se perdió la vista tridimensional. La lista sigue disponible con los mismos proyectos.')
      },
    })
    scene.setVisible(ui.currentIds())
    if (startList) scene.setPaused(true)
  } catch {
    ui.forceList(
      'La vista tridimensional no está disponible en este navegador. Puedes recorrer los mismos proyectos en la lista.',
    )
  }
}

void main()
