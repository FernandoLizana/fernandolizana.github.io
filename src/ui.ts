import {
  countLabel,
  formatDay,
  initialFilters,
  isArchivedFilter,
  isForkFilter,
  isHttpUrl,
  languagesIn,
  visibleRepos,
} from './catalog.ts'
import { entryFor, featuredRepos, type Editorial } from './editorial.ts'
import { colorForLanguage } from './groups.ts'
import type { SceneLabel } from './scene.ts'
import type { Catalog, FilterState, Repo } from './types.ts'

export type HoverHit = {
  id: number
  name: string
  x: number
  y: number
}

export type UiController = {
  currentIds(): Set<number>
  featuredIds(): number[]
  hover(hit: HoverHit | null): void
  placeLabels(labels: SceneLabel[]): void
  select(id: number): void
  openDetail(id: number): void
  closeDetail(): void
  isDetailOpen(): boolean
  showGalaxy(): void
  showList(): void
  forceList(message: string): void
}

type Handlers = {
  onFilters: (ids: Set<number>) => void
  onSelect: (id: number) => void
  onCloseDetail: () => void
  onReset: () => void
  onView: (view: 'galaxy' | 'list') => void
  onMotion: (enabled: boolean) => void
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`No se encontró ${selector} en la página.`)
  return element
}

function flag(text: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'flag'
  span.textContent = text
  return span
}

function externalLink(anchor: HTMLAnchorElement, href: string | null, label: string) {
  if (!isHttpUrl(href)) {
    anchor.hidden = true
    anchor.removeAttribute('href')
    return
  }
  anchor.hidden = false
  anchor.href = href
  anchor.textContent = label
}

function kindLabel(repo: Repo): string {
  if (repo.fork) return 'Bifurcación'
  if (repo.archived) return 'Archivado'
  return 'Repositorio propio'
}

export function mountUi(options: {
  catalog: Catalog
  editorial: Editorial
  motion: boolean
  startList: boolean
  handlers: Handlers
}): UiController {
  const { catalog, editorial, handlers } = options
  const byId = new Map(catalog.repos.map((repo) => [repo.id, repo]))
  const featured = featuredRepos(catalog.repos, editorial)
  const featuredIds = new Set(featured.map((repo) => repo.id))
  const state: FilterState = initialFilters(catalog.repos)
  let view: 'galaxy' | 'list' = 'galaxy'
  let webglAvailable = true
  let openId: number | null = null
  let activeResult = -1
  let restoreFocus: HTMLElement | null = null

  const query = required<HTMLInputElement>('#q')
  const results = required<HTMLUListElement>('#search-results')
  const languageBox = required<HTMLDivElement>('#language-filters')
  const forkFilter = required<HTMLSelectElement>('#fork-filter')
  const archivedFilter = required<HTMLSelectElement>('#archived-filter')
  const count = required<HTMLParagraphElement>('#count')
  const legendBody = required<HTMLDivElement>('#legend-body')
  const sync = required<HTMLParagraphElement>('#sync')
  const coverage = required<HTMLParagraphElement>('#coverage')
  const empty = required<HTMLParagraphElement>('#empty')
  const fallback = required<HTMLParagraphElement>('#fallback-note')
  const detail = required<HTMLElement>('#detail')
  const detailKicker = required<HTMLParagraphElement>('#detail-kicker')
  const detailTitle = required<HTMLHeadingElement>('#detail-title')
  const detailFlags = required<HTMLParagraphElement>('#detail-flags')
  const detailFigure = required<HTMLElement>('#detail-figure')
  const detailImage = required<HTMLImageElement>('#detail-image')
  const detailDescription = required<HTMLParagraphElement>('#detail-description')
  const detailDoes = required<HTMLElement>('#detail-does')
  const detailDoesText = required<HTMLParagraphElement>('#detail-does-text')
  const detailPoints = required<HTMLUListElement>('#detail-points')
  const detailBuilt = required<HTMLElement>('#detail-built')
  const detailStack = required<HTMLParagraphElement>('#detail-stack')
  const detailMeta = required<HTMLDListElement>('#detail-meta')
  const detailTopics = required<HTMLDivElement>('#detail-topics')
  const detailUpdated = required<HTMLParagraphElement>('#detail-updated')
  const detailRole = required<HTMLParagraphElement>('#detail-role')
  const detailRepo = required<HTMLAnchorElement>('#detail-repo')
  const detailHome = required<HTMLAnchorElement>('#detail-home')
  const detailClose = required<HTMLButtonElement>('#detail-close')
  const list = required<HTMLElement>('#lista')
  const listTitle = required<HTMLHeadingElement>('#list-title')
  const listItems = required<HTMLDivElement>('#list-items')
  const viewGalaxy = required<HTMLButtonElement>('#view-galaxy')
  const viewToggle = required<HTMLButtonElement>('#view-toggle')
  const motionButton = required<HTMLButtonElement>('#motion')
  const resetButton = required<HTMLButtonElement>('#reset-view')
  const hoverLabel = required<HTMLParagraphElement>('#hover-label')
  const canvas = required<HTMLCanvasElement>('#galaxy')
  const starLabels = required<HTMLDivElement>('#star-labels')
  const featuredGrid = required<HTMLDivElement>('#featured-grid')

  paintMotion(options.motion)
  const synced = formatDay(catalog.syncedAt)
  sync.textContent = synced ? `Sincronizado el ${synced} (UTC).` : 'Sin fecha de sincronización.'
  coverage.textContent = catalog.excludedCount
    ? `GitHub tiene ${catalog.publicRepos} repositorios públicos. Esta galaxia muestra ${catalog.count} y deja fuera ${catalog.excludedCount}, los que figuran en la lista de exclusión. La descarga recorre todas las páginas y tiene que coincidir con el total del perfil.`
    : `GitHub tiene ${catalog.publicRepos} repositorios públicos y todos están en esta galaxia.`

  for (const language of languagesIn(catalog.repos)) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = true
    input.value = language
    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    swatch.style.background = colorForLanguage(language)
    swatch.setAttribute('aria-hidden', 'true')
    label.append(input, swatch, document.createTextNode(language))
    input.addEventListener('change', () => {
      if (input.checked) state.languages.add(language)
      else state.languages.delete(language)
      emit()
    })
    languageBox.append(label)
  }
  renderLegend()
  renderFeatured()

  function paintMotion(enabled: boolean) {
    motionButton.setAttribute('aria-pressed', enabled ? 'true' : 'false')
    motionButton.textContent = enabled ? 'Pausar' : 'Reanudar'
  }

  function currentVisible(): Repo[] {
    return visibleRepos(catalog.repos, state)
  }

  function currentIds(): Set<number> {
    return new Set(currentVisible().map((repo) => repo.id))
  }

  function emit() {
    const visible = currentVisible()
    count.textContent = countLabel(visible.length, catalog.count)
    handlers.onFilters(currentIds())
    renderResults()
    renderList(visible)
    renderFeatured()
    if (catalog.count === 0) {
      empty.hidden = view === 'list'
      empty.textContent = 'Todavía no hay proyectos en esta galaxia. Los que publiques aparecerán aquí como estrellas.'
    } else if (visible.length === 0 && view === 'galaxy') {
      empty.hidden = false
      empty.textContent = 'Ningún proyecto coincide con la búsqueda o los filtros.'
    } else {
      empty.hidden = true
    }
    if (openId !== null && !visible.some((repo) => repo.id === openId)) closeDetail()
  }

  function renderLegend() {
    legendBody.replaceChildren()
    const row = document.createElement('div')
    row.className = 'legend-row'
    for (const language of languagesIn(catalog.repos)) {
      const item = document.createElement('span')
      const swatch = document.createElement('i')
      swatch.className = 'swatch'
      swatch.style.background = colorForLanguage(language)
      item.append(swatch, document.createTextNode(language))
      row.append(item)
    }
    if (!row.childElementCount) return
    legendBody.append(row)
  }

  function renderFeatured() {
    featuredGrid.replaceChildren()
    const visible = new Set(currentVisible().map((repo) => repo.id))
    const shown = featured.filter((repo) => visible.has(repo.id))
    if (!shown.length) {
      const message = document.createElement('p')
      message.textContent = catalog.count
        ? 'Ningún destacado coincide con la búsqueda o los filtros.'
        : 'Todavía no hay proyectos públicos para destacar.'
      featuredGrid.append(message)
      return
    }
    for (const repo of shown) featuredGrid.append(featuredCard(repo))
  }

  function featuredCard(repo: Repo): HTMLElement {
    const entry = entryFor(editorial, repo)
    const article = document.createElement('article')
    article.className = 'featured-card'
    if (entry?.image) {
      const image = document.createElement('img')
      image.src = entry.image.src
      image.alt = entry.image.alt
      article.append(image)
    }
    const heading = document.createElement('h3')
    heading.textContent = repo.name
    article.append(heading)
    const description = document.createElement('p')
    description.textContent = repo.description ?? entry?.does ?? 'Este repositorio no incluye descripción.'
    article.append(description)
    const meta = document.createElement('p')
    meta.className = 'quiet'
    meta.textContent = [kindLabel(repo), repo.language ?? 'Sin lenguaje principal'].join(' · ')
    article.append(meta)
    const actions = document.createElement('p')
    actions.className = 'featured-actions'
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'open'
    open.textContent = 'Abrir ficha'
    open.addEventListener('click', () => select(repo.id))
    const repoLink = document.createElement('a')
    repoLink.target = '_blank'
    repoLink.rel = 'noopener noreferrer'
    externalLink(repoLink, repo.htmlUrl, 'Repositorio')
    actions.append(open, repoLink)
    article.append(actions)
    return article
  }

  function hideResults() {
    results.hidden = true
    results.replaceChildren()
    query.setAttribute('aria-expanded', 'false')
    activeResult = -1
  }

  function renderResults() {
    const queryText = state.query.trim()
    if (!queryText) {
      hideResults()
      return
    }
    const matches = currentVisible()
    results.replaceChildren()
    if (!matches.length) {
      const item = document.createElement('li')
      item.className = 'search-empty'
      item.textContent = 'Ningún proyecto coincide.'
      results.append(item)
      results.hidden = false
      query.setAttribute('aria-expanded', 'true')
      return
    }
    const shown = matches.slice(0, 8)
    shown.forEach((repo, index) => {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'option')
      button.id = `search-option-${repo.id}`
      button.setAttribute('aria-selected', index === activeResult ? 'true' : 'false')
      const name = document.createElement('strong')
      name.textContent = repo.name
      button.append(name)
      if (repo.description) {
        const description = document.createElement('span')
        description.textContent = repo.description
        button.append(description)
      }
      button.addEventListener('click', () => select(repo.id))
      item.append(button)
      results.append(item)
    })
    results.hidden = false
    query.setAttribute('aria-expanded', 'true')
    const selected = results.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    if (selected) query.setAttribute('aria-activedescendant', selected.id)
    else query.removeAttribute('aria-activedescendant')
  }

  function renderList(repos: Repo[]) {
    listItems.replaceChildren()
    if (!repos.length) {
      const message = document.createElement('p')
      message.textContent =
        catalog.count === 0
          ? 'Todavía no hay proyectos en esta galaxia. Los que publiques aparecerán aquí como estrellas.'
          : 'Ningún proyecto coincide con la búsqueda o los filtros.'
      listItems.append(message)
      return
    }
    for (const repo of repos) listItems.append(listCard(repo))
  }

  function listCard(repo: Repo): HTMLElement {
    const entry = entryFor(editorial, repo)
    const article = document.createElement('article')
    article.className = 'card'
    const heading = document.createElement('h3')
    const titleLink = document.createElement('a')
    titleLink.href = repo.htmlUrl
    titleLink.target = '_blank'
    titleLink.rel = 'noopener noreferrer'
    titleLink.textContent = repo.name
    heading.append(titleLink)
    article.append(heading)
    const flags = document.createElement('p')
    flags.className = 'flags'
    flags.append(flag(kindLabel(repo)))
    if (repo.fork && repo.archived) flags.append(flag('Archivado'))
    article.append(flags)
    const description = document.createElement('p')
    description.textContent = entry?.does ?? repo.description ?? 'Este repositorio no incluye descripción.'
    article.append(description)
    const meta = document.createElement('p')
    meta.className = 'quiet'
    const day = formatDay(repo.pushedAt)
    meta.textContent = [repo.language ?? 'Sin lenguaje principal', day ? `Actualizado el ${day} (UTC)` : null]
      .filter(Boolean)
      .join(' · ')
    article.append(meta)
    const actions = document.createElement('p')
    actions.className = 'card-actions'
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'open'
    open.textContent = 'Abrir ficha'
    open.addEventListener('click', () => select(repo.id))
    const repoLink = document.createElement('a')
    repoLink.target = '_blank'
    repoLink.rel = 'noopener noreferrer'
    externalLink(repoLink, repo.htmlUrl, 'Ver repositorio')
    actions.append(open, repoLink)
    if (isHttpUrl(repo.homepage)) {
      const home = document.createElement('a')
      home.target = '_blank'
      home.rel = 'noopener noreferrer'
      externalLink(home, repo.homepage, 'Visitar proyecto')
      actions.append(home)
    }
    article.append(actions)
    return article
  }

  function openDetail(id: number) {
    const repo = byId.get(id)
    if (!repo) return
    openId = id
    const entry = entryFor(editorial, repo)
    detail.dataset.repoId = String(repo.id)
    detailKicker.textContent = kindLabel(repo)
    detailTitle.textContent = repo.name
    detailFlags.replaceChildren()
    if (repo.fork) detailFlags.append(flag('Bifurcación'))
    if (repo.archived) detailFlags.append(flag('Archivado'))
    detailFlags.hidden = detailFlags.childElementCount === 0
    if (entry?.image) {
      detailImage.src = entry.image.src
      detailImage.alt = entry.image.alt
      detailFigure.hidden = false
    } else {
      detailImage.removeAttribute('src')
      detailFigure.hidden = true
    }
    detailDescription.textContent = repo.description ?? 'Este repositorio no incluye descripción.'
    const does = entry?.does && entry.does !== repo.description ? entry.does : ''
    detailDoesText.textContent = does
    detailPoints.replaceChildren()
    for (const point of entry?.points ?? []) {
      const item = document.createElement('li')
      item.textContent = point
      detailPoints.append(item)
    }
    detailDoes.hidden = !does && detailPoints.childElementCount === 0
    const built = [...(entry?.built ?? [])]
    if (!built.length && repo.language) built.push(repo.language)
    detailStack.textContent = built.join(' · ')
    detailBuilt.hidden = built.length === 0
    detailMeta.replaceChildren()
    const rows: Array<[string, string]> = [['Lenguaje principal', repo.language ?? 'Sin lenguaje principal']]
    if (repo.stargazersCount > 0) rows.push(['Estrellas en GitHub', String(repo.stargazersCount)])
    if (repo.forksCount > 0) rows.push(['Bifurcaciones', String(repo.forksCount)])
    for (const [term, value] of rows) {
      const dt = document.createElement('dt')
      dt.textContent = term
      const dd = document.createElement('dd')
      dd.textContent = value
      detailMeta.append(dt, dd)
    }
    detailTopics.replaceChildren()
    if (repo.topics.length) {
      const topics = document.createElement('p')
      topics.className = 'topics'
      for (const topic of repo.topics) {
        const span = document.createElement('span')
        span.className = 'topic'
        span.textContent = topic
        topics.append(span)
      }
      detailTopics.append(topics)
    }
    const day = formatDay(repo.pushedAt)
    detailUpdated.textContent = day ? `Actualizado el ${day} (UTC).` : ''
    detailRole.hidden = !repo.fork
    detailRole.textContent = repo.fork
      ? 'Es una bifurcación: el trabajo original es de otros autores. Esta ficha solo describe la copia pública de la cuenta.'
      : ''
    externalLink(detailRepo, repo.htmlUrl, 'Ver repositorio')
    externalLink(detailHome, repo.homepage, 'Visitar proyecto')
    detail.hidden = false
    if (document.activeElement !== detailClose) {
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      detailClose.focus({ preventScroll: true })
    }
  }

  function closeDetail() {
    if (detail.hidden) return
    detail.hidden = true
    detail.removeAttribute('data-repo-id')
    openId = null
    handlers.onCloseDetail()
    restoreFocus?.focus({ preventScroll: true })
    restoreFocus = null
  }

  function showGalaxy() {
    if (!webglAvailable) return
    view = 'galaxy'
    list.hidden = true
    canvas.hidden = false
    starLabels.hidden = false
    document.body.dataset.view = 'galaxy'
    viewGalaxy.setAttribute('aria-pressed', 'true')
    viewToggle.setAttribute('aria-pressed', 'false')
    handlers.onView('galaxy')
    window.dispatchEvent(new Event('resize'))
    emit()
  }

  function showList() {
    view = 'list'
    list.hidden = false
    hoverLabel.hidden = true
    starLabels.hidden = true
    document.body.dataset.view = 'list'
    viewGalaxy.setAttribute('aria-pressed', 'false')
    viewToggle.setAttribute('aria-pressed', 'true')
    handlers.onView('list')
    emit()
    if (document.activeElement === viewToggle || document.activeElement === viewGalaxy) {
      listTitle.focus({ preventScroll: true })
    }
  }

  function select(id: number) {
    hideResults()
    if (webglAvailable && view === 'list') showGalaxy()
    openDetail(id)
    handlers.onSelect(id)
  }

  function placeLabels(labels: SceneLabel[]) {
    if (view === 'list') {
      starLabels.replaceChildren()
      return
    }
    const height = canvas.clientHeight
    const width = canvas.clientWidth
    if (width < 40 || height < 40) return
    const sorted = labels
      .filter((label) => label.visible)
      .map((label) => ({ ...label }))
      .sort((a, b) => a.y - b.y || a.x - b.x)
    const wanted = new Set(sorted.map((label) => label.id))
    for (const button of [...starLabels.querySelectorAll<HTMLButtonElement>('button')]) {
      if (!wanted.has(Number(button.dataset.id))) button.remove()
    }
    const placed: Array<{ x: number; y: number }> = []
    const floor = Math.max(36, height - 132)
    for (const label of sorted) {
      let y = Math.min(Math.max(label.y, 36), floor)
      for (const other of placed) {
        if (Math.abs(other.x - label.x) < 140 && Math.abs(other.y - y) < 30) y = Math.min(floor, other.y + 32)
      }
      const pad = Math.min(72, Math.max(28, width * 0.12))
      const x = Math.min(width - pad, Math.max(pad, label.x))
      placed.push({ x, y })
      let button = starLabels.querySelector<HTMLButtonElement>(`button[data-id="${label.id}"]`)
      if (!button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'star-label'
        button.dataset.id = String(label.id)
        button.textContent = label.name
        button.addEventListener('click', (event) => {
          event.stopPropagation()
          select(label.id)
        })
        starLabels.append(button)
      }
      button.style.left = `${x}px`
      button.style.top = `${y}px`
      button.classList.toggle('is-dim', openId !== null && openId !== label.id)
      if (openId === label.id) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
    }
  }

  query.addEventListener('input', () => {
    state.query = query.value
    activeResult = -1
    emit()
  })

  query.addEventListener('keydown', (event) => {
    const optionsButtons = [...results.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    if (event.key === 'ArrowDown' && optionsButtons.length) {
      event.preventDefault()
      activeResult = Math.min(optionsButtons.length - 1, activeResult + 1)
      renderResults()
    } else if (event.key === 'ArrowUp' && optionsButtons.length) {
      event.preventDefault()
      activeResult = Math.max(0, activeResult - 1)
      renderResults()
    } else if (event.key === 'Enter' && activeResult >= 0) {
      event.preventDefault()
      const id = Number(optionsButtons[activeResult]?.id.replace('search-option-', ''))
      if (Number.isFinite(id)) select(id)
    } else if (event.key === 'Escape' && !results.hidden) {
      event.preventDefault()
      event.stopPropagation()
      hideResults()
    }
  })

  document.addEventListener('pointerdown', (event) => {
    const target = event.target
    if (!(target instanceof Node)) return
    if (!query.parentElement?.contains(target)) hideResults()
  })

  forkFilter.addEventListener('change', () => {
    if (isForkFilter(forkFilter.value)) state.forks = forkFilter.value
    emit()
  })
  archivedFilter.addEventListener('change', () => {
    if (isArchivedFilter(archivedFilter.value)) state.archived = archivedFilter.value
    emit()
  })
  viewGalaxy.addEventListener('click', () => showGalaxy())
  viewToggle.addEventListener('click', () => {
    if (view === 'galaxy') showList()
    else showGalaxy()
  })
  motionButton.addEventListener('click', () => {
    const enabled = motionButton.getAttribute('aria-pressed') !== 'true'
    paintMotion(enabled)
    handlers.onMotion(enabled)
  })
  resetButton.addEventListener('click', () => handlers.onReset())
  document.querySelector('.skip')?.addEventListener('click', (event) => {
    event.preventDefault()
    document.querySelector('#observatorio')?.scrollIntoView()
    if (webglAvailable) showGalaxy()
    else showList()
  })
  detailClose.addEventListener('click', () => closeDetail())
  detail.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || detail.hidden) return
    const focusable = [...detail.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')]
      .filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (!detail.hidden) {
      event.preventDefault()
      closeDetail()
    }
  })

  emit()
  if (options.startList) showList()

  return {
    currentIds,
    featuredIds: () => featured.map((repo) => repo.id),
    hover(hit) {
      if (!hit || view === 'list' || featuredIds.has(hit.id)) {
        hoverLabel.hidden = true
        return
      }
      hoverLabel.hidden = false
      hoverLabel.textContent = hit.name
      const rect = canvas.getBoundingClientRect()
      hoverLabel.style.left = `${hit.x - rect.left}px`
      hoverLabel.style.top = `${hit.y - rect.top}px`
    },
    placeLabels,
    select,
    openDetail,
    closeDetail,
    isDetailOpen: () => !detail.hidden,
    showGalaxy,
    showList,
    forceList(message) {
      webglAvailable = false
      canvas.hidden = true
      starLabels.hidden = true
      fallback.hidden = false
      fallback.textContent = message
      viewGalaxy.disabled = true
      viewToggle.disabled = true
      resetButton.disabled = true
      motionButton.disabled = true
      showList()
    },
  }
}

export function preferredMotion(): boolean {
  try {
    const stored = localStorage.getItem('universo-motion')
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch {
    /* el almacenamiento puede estar bloqueado */
  }
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function storeMotion(enabled: boolean) {
  try {
    localStorage.setItem('universo-motion', enabled ? 'on' : 'off')
  } catch {
    /* igual se aplica durante esta visita */
  }
}
