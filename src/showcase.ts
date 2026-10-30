import { languagesIn } from './catalog.ts'
import type { Catalog } from './types.ts'

const number = new Intl.NumberFormat('es-CL')

/** Cifras, cinta de temas y efectos de la página que no dependen de la galaxia. */
export function mountShowcase(catalog: Catalog, motion: () => boolean) {
  const topics = [...new Set(catalog.repos.flatMap((repo) => repo.topics))].sort()
  const stats: Record<string, number> = {
    repos: catalog.count,
    files: catalog.repos.reduce((total, repo) => total + repo.fileCount, 0),
    languages: languagesIn(catalog.repos).length,
    topics: topics.length,
  }

  const heroCount = document.querySelector<HTMLElement>('#hero-count')
  if (heroCount && catalog.count) {
    heroCount.textContent = `${catalog.count} proyectos en órbita`
  }

  const marquee = document.querySelector<HTMLElement>('#marquee')
  if (marquee && topics.length) {
    const run = () => {
      const group = document.createElement('div')
      group.className = 'marquee-group'
      for (const topic of topics) {
        const item = document.createElement('span')
        item.textContent = topic
        group.append(item)
      }
      return group
    }
    marquee.append(run(), run())
  } else {
    marquee?.parentElement?.remove()
  }

  const counters = [...document.querySelectorAll<HTMLElement>('[data-stat]')]
  for (const counter of counters) counter.textContent = number.format(stats[counter.dataset.stat ?? ''] ?? 0)

  function countUp(element: HTMLElement) {
    const target = stats[element.dataset.stat ?? ''] ?? 0
    if (!motion() || target < 2) {
      element.textContent = number.format(target)
      return
    }
    const start = performance.now()
    const duration = 1600
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 4
      element.textContent = number.format(Math.round(target * eased))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const element = entry.target as HTMLElement
        element.classList.add('is-in')
        const counter = element.querySelector<HTMLElement>('[data-stat]')
        if (counter) countUp(counter)
        reveal.unobserve(element)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  )
  const watch = () => {
    document.querySelectorAll<HTMLElement>('.reveal:not(.is-in)').forEach((element) => reveal.observe(element))
  }
  document.documentElement.classList.add('js-reveal')
  watch()
  document.querySelector('#featured-grid')?.addEventListener('cards', watch)

  // Luz que sigue al puntero en las tarjetas.
  document.addEventListener('pointermove', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const card = target.closest<HTMLElement>('.featured-card, .area-grid article')
    if (!card) return
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`)
    card.style.setProperty('--my', `${event.clientY - rect.top}px`)
  })

  const nav = document.querySelector<HTMLElement>('.nav')
  const onScroll = () => nav?.classList.toggle('is-scrolled', window.scrollY > 24)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}
