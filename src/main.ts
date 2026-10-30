import { loadCatalog } from './catalog.ts'
import { loadEditorial } from './editorial.ts'
import { createScene, type SceneController } from './scene.ts'
import { mountShowcase } from './showcase.ts'
import { mountUi, preferredMotion, storeMotion } from './ui.ts'

const wideLayout = () => window.matchMedia('(min-width: 981px)').matches

/** Franja vertical del lienzo que queda libre bajo el texto de la portada, en teléfonos. */
function freeBand(height: number) {
  const copy = document.querySelector<HTMLElement>('.hero-copy')
  const dock = document.querySelector<HTMLElement>('.dock')
  const top = (copy?.offsetHeight ?? height * 2) - (copy ? parseFloat(getComputedStyle(copy).paddingBottom) : 0)
  const bottom = height - (dock?.offsetHeight ?? 0) - 16
  return { top: Math.min(top, bottom - 200), bottom }
}

/** Dónde queda el centro de la galaxia: a la derecha del texto en escritorio, bajo el texto en el teléfono. */
function framing(selected: boolean, width: number, height: number) {
  if (wideLayout()) {
    if (selected) return { x: -Math.min(210, width * 0.2) / width, y: 0 }
    return { x: width >= 1280 ? 0.2 : 0.24, y: -0.05 }
  }
  if (selected) return { x: 0, y: 0 }
  const band = freeBand(height)
  return { x: 0, y: (band.top + band.bottom) / 2 / height - 0.5 }
}

/** Qué tan lejos parte la cámara, según el espacio libre para la galaxia. */
function zoom(width: number, height: number) {
  if (wideLayout()) return width >= 1280 ? 0.8 : 1.05
  const band = freeBand(height)
  // La escena se encuadra para el alto completo; en un teléfono solo hay una franja.
  return Math.max(1, Math.min(2.4, (height / Math.max(band.bottom - band.top, 1)) * 0.8))
}

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
  mountShowcase(catalog, () => ambient)

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
      framing,
      zoom,
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
