import {
  countLabel,
  formatDay,
  initialFilters,
  isArchivedFilter,
  isForkFilter,
  isHttpUrl,
  languagesIn,
  plural,
  visibleRepos,
} from './catalog.ts'
import { colorForLanguage } from './groups.ts'
import type { Catalog, FilterState, Repo } from './types.ts'

export type HoverHit = {
  id: number
  name: string
  x: number
  y: number
}

export type UiController = {
  currentIds(): Set<number>
  hover(hit: HoverHit | null): void
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

export function mountUi(options: {
  catalog: Catalog
  motion: boolean
  startList: boolean
  handlers: Handlers
}): UiController {
  const { catalog, handlers } = options
  const byId = new Map(catalog.repos.map((repo) => [repo.id, repo]))
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
  const empty = required<HTMLParagraphElement>('#empty')
  const fallback = required<HTMLParagraphElement>('#fallback-note')
  const detail = required<HTMLElement>('#detail')
  const detailTitle = required<HTMLHeadingElement>('#detail-title')
  const detailFlags = required<HTMLParagraphElement>('#detail-flags')
  const detailDescription = required<HTMLParagraphElement>('#detail-description')
  const detailMeta = required<HTMLDListElement>('#detail-meta')
  const detailTopics = required<HTMLDivElement>('#detail-topics')
  const detailRepo = required<HTMLAnchorElement>('#detail-repo')
  const detailHome = required<HTMLAnchorElement>('#detail-home')
  const detailClose = required<HTMLButtonElement>('#detail-close')
  const list = required<HTMLElement>('#lista')
  const listTitle = required<HTMLHeadingElement>('#list-title')
  const listItems = required<HTMLDivElement>('#list-items')
  const viewToggle = required<HTMLButtonElement>('#view-toggle')
  const motionButton = required<HTMLButtonElement>('#motion')
  const resetButton = required<HTMLButtonElement>('#reset-view')
  const hoverLabel = required<HTMLParagraphElement>('#hover-label')
  const canvas = required<HTMLCanvasElement>('#galaxy')

  motionButton.setAttribute('aria-pressed', options.motion ? 'true' : 'false')
  sync.textContent = `Sincronizado el ${formatDay(catalog.syncedAt)} (UTC).`

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
    const title = document.createElement('p')
    title.className = 'legend-title'
    title.textContent = 'Constelaciones'
    const listEl = document.createElement('ul')
    for (const language of languagesIn(catalog.repos)) {
      const item = document.createElement('li')
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      swatch.style.background = colorForLanguage(language)
      item.append(swatch, document.createTextNode(language))
      listEl.append(item)
    }
    const notes = [
      'El color indica el lenguaje principal.',
      'Las líneas agrupan el mismo lenguaje. No son dependencias.',
      'Anillo: bifurcación. Menos brillo: archivado.',
      'El polvo y las estrellas pequeñas no son repositorios.',
    ]
    legendBody.append(title, listEl)
    for (const note of notes) {
      const paragraph = document.createElement('p')
      paragraph.textContent = note
      legendBody.append(paragraph)
    }
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
    if (matches.length > shown.length) {
      const more = document.createElement('li')
      more.className = 'search-more'
      more.textContent = `${matches.length} coincidencias. La galaxia muestra todas.`
      results.append(more)
    }
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
    for (const repo of repos) listItems.append(renderCard(repo))
  }

  function renderCard(repo: Repo): HTMLElement {
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
    if (repo.fork) flags.append(flag('Bifurcación'))
    if (repo.archived) flags.append(flag('Archivado'))
    if (flags.childElementCount) article.append(flags)
    const description = document.createElement('p')
    description.textContent = repo.description ?? 'Este repositorio no incluye descripción.'
    article.append(description)
    article.append(metaList(repo))
    if (repo.topics.length) article.append(topicList(repo.topics))
    const actions = document.createElement('p')
    actions.className = 'card-actions'
    const repoLink = document.createElement('a')
    repoLink.target = '_blank'
    repoLink.rel = 'noopener noreferrer'
    externalLink(repoLink, repo.htmlUrl, 'Ver repositorio')
    actions.append(repoLink)
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

  function metaList(repo: Repo): HTMLDListElement {
    const listEl = document.createElement('dl')
    const rows: Array<[string, string]> = [
      ['Lenguaje principal', repo.language ?? 'Sin lenguaje principal'],
      ['Estrellas en GitHub', plural(repo.stargazersCount, 'estrella', 'estrellas')],
      ['Bifurcaciones', plural(repo.forksCount, 'bifurcación', 'bifurcaciones')],
      ['Último push', formatDay(repo.pushedAt) ? `${formatDay(repo.pushedAt)} (UTC)` : 'Sin fecha de último push.'],
    ]
    for (const [term, value] of rows) {
      const dt = document.createElement('dt')
      dt.textContent = term
      const dd = document.createElement('dd')
      dd.textContent = value
      listEl.append(dt, dd)
    }
    return listEl
  }

  function topicList(topics: string[]): HTMLParagraphElement {
    const paragraph = document.createElement('p')
    paragraph.className = 'topics'
    for (const topic of topics) {
      const span = document.createElement('span')
      span.className = 'topic'
      span.textContent = topic
      paragraph.append(span)
    }
    return paragraph
  }

  function openDetail(id: number) {
    const repo = byId.get(id)
    if (!repo) return
    openId = id
    detail.dataset.repoId = String(repo.id)
    detailTitle.textContent = repo.name
    detailFlags.replaceChildren()
    if (repo.fork) detailFlags.append(flag('Bifurcación'))
    if (repo.archived) detailFlags.append(flag('Archivado'))
    detailFlags.hidden = detailFlags.childElementCount === 0
    detailDescription.textContent = repo.description ?? 'Este repositorio no incluye descripción.'
    detailMeta.replaceChildren(...metaList(repo).childNodes)
    detailTopics.replaceChildren()
    if (repo.topics.length) detailTopics.append(topicList(repo.topics))
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
    document.body.dataset.view = 'galaxy'
    viewToggle.textContent = 'Lista de proyectos'
    viewToggle.setAttribute('aria-pressed', 'false')
    handlers.onView('galaxy')
    emit()
  }

  function showList() {
    view = 'list'
    list.hidden = false
    hoverLabel.hidden = true
    document.body.dataset.view = 'list'
    viewToggle.textContent = 'Ver galaxia'
    viewToggle.setAttribute('aria-pressed', 'true')
    handlers.onView('list')
    emit()
    if (document.activeElement === viewToggle) listTitle.focus({ preventScroll: true })
  }

  function select(id: number) {
    hideResults()
    if (webglAvailable && view === 'list') showGalaxy()
    openDetail(id)
    handlers.onSelect(id)
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
  viewToggle.addEventListener('click', () => {
    if (view === 'galaxy') showList()
    else showGalaxy()
  })
  motionButton.addEventListener('click', () => {
    const enabled = motionButton.getAttribute('aria-pressed') !== 'true'
    motionButton.setAttribute('aria-pressed', enabled ? 'true' : 'false')
    handlers.onMotion(enabled)
  })
  resetButton.addEventListener('click', () => handlers.onReset())
  document.querySelector('.skip')?.addEventListener('click', (event) => {
    event.preventDefault()
    showList()
    listTitle.focus({ preventScroll: true })
  })
  detailClose.addEventListener('click', () => closeDetail())
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (!detail.hidden) {
      event.preventDefault()
      closeDetail()
    }
  })

  const header = document.querySelector<HTMLElement>('.top')
  const syncHeader = () => {
    if (!header) return
    document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`)
  }
  syncHeader()
  window.addEventListener('resize', syncHeader)

  emit()
  if (options.startList) showList()

  return {
    currentIds,
    hover(hit) {
      if (!hit || view === 'list') {
        hoverLabel.hidden = true
        return
      }
      hoverLabel.hidden = false
      hoverLabel.textContent = hit.name
      const width = hoverLabel.offsetWidth
      const height = hoverLabel.offsetHeight
      const margin = 10
      const left = Math.min(window.innerWidth - margin - width / 2, Math.max(margin + width / 2, hit.x))
      const above = hit.y - height - 14
      hoverLabel.style.left = `${left}px`
      hoverLabel.style.top = `${hit.y}px`
      hoverLabel.style.transform = above < margin ? 'translate(-50%, 16px)' : 'translate(-50%, calc(-100% - 14px))'
    },
    select,
    openDetail,
    closeDetail,
    isDetailOpen: () => !detail.hidden,
    showGalaxy,
    showList,
    forceList(message) {
      webglAvailable = false
      canvas.hidden = true
      fallback.hidden = false
      fallback.textContent = message
      viewToggle.disabled = true
      resetButton.disabled = true
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
