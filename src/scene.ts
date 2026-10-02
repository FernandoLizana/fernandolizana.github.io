import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildStarLayout, colorForLanguage, constellationPairs, frameHome } from './groups.ts'
import type { Repo } from './types.ts'

const HOME_POS = new THREE.Vector3(0, 12, 54)
const HOME_TARGET = new THREE.Vector3(0, 0, 0)
const FOCUS_OFFSET = new THREE.Vector3(7, 8, 18)

export type HoverHit = {
  id: number
  name: string
  x: number
  y: number
}

export type SceneLabel = {
  id: number
  name: string
  x: number
  y: number
  visible: boolean
}

export type SceneController = {
  setVisible(ids: ReadonlySet<number>): void
  focus(id: number, animate: boolean): void
  clearSelection(): void
  resetView(animate: boolean): void
  setMotion(enabled: boolean): void
  setPaused(paused: boolean): void
  destroy(): void
}

type Quality = {
  dust: number
  sky: number
  nebulas: number
  pixelRatio: number
  antialias: boolean
  starScale: number
}

type StarRecord = {
  id: number
  name: string
  language: string
  archived: boolean
  position: THREE.Vector3
  core: THREE.Sprite
  halo: THREE.Sprite
  baseCore: number
  baseHalo: number
}

type Flight = {
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  start: number
  duration: number
}

function detectQuality(): Quality {
  const cores = navigator.hardwareConcurrency || 4
  const narrow = window.matchMedia('(max-width: 800px)').matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const low = narrow || cores <= 4
  return {
    dust: low ? 1400 : 5600,
    sky: low ? 650 : 1600,
    nebulas: low ? 3 : 5,
    pixelRatio: Math.min(window.devicePixelRatio || 1, low ? 1.25 : 1.6),
    antialias: !low,
    starScale: coarse ? 1.38 : 1,
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function makeTexture(
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo preparar el cielo.')
  draw(context, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function softDisk(): THREE.CanvasTexture {
  return makeTexture(64, (context, size) => {
    const center = size / 2
    const gradient = context.createRadialGradient(center, center, 0, center, center, center)
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  })
}

function coreTexture(hex: string, fork: boolean): THREE.CanvasTexture {
  return makeTexture(128, (context, size) => {
    const center = size / 2
    const gradient = context.createRadialGradient(center, center, 0, center, center, center)
    gradient.addColorStop(0, '#fffaf3')
    gradient.addColorStop(0.16, '#fffaf3')
    gradient.addColorStop(0.38, hex)
    gradient.addColorStop(0.72, hexToRgba(hex, 0.15))
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
    if (fork) {
      context.beginPath()
      context.arc(center, center, size * 0.34, 0, Math.PI * 2)
      context.strokeStyle = hex
      context.globalAlpha = 0.9
      context.lineWidth = 4
      context.stroke()
    }
  })
}

function haloTexture(hex: string): THREE.CanvasTexture {
  return makeTexture(256, (context, size) => {
    const center = size / 2
    const gradient = context.createRadialGradient(center, center, size * 0.02, center, center, center)
    gradient.addColorStop(0, hexToRgba(hex, 0.02))
    gradient.addColorStop(0.18, hexToRgba(hex, 0.55))
    gradient.addColorStop(0.42, hexToRgba(hex, 0.18))
    gradient.addColorStop(1, hexToRgba(hex, 0))
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  })
}

function nebulaTexture(inner: string, outer: string): THREE.CanvasTexture {
  return makeTexture(256, (context, size) => {
    const center = size / 2
    const gradient = context.createRadialGradient(center, center, size * 0.05, center, center, center)
    gradient.addColorStop(0, inner)
    gradient.addColorStop(0.45, outer)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  })
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let next = Math.imul(state ^ (state >>> 15), 1 | state)
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

export function createScene(options: {
  canvas: HTMLCanvasElement
  repos: Repo[]
  featuredIds: readonly number[]
  motion: boolean
  onHover: (hit: HoverHit | null) => void
  onSelect: (id: number) => void
  onLabels: (labels: SceneLabel[]) => void
  onContextLost: () => void
}): SceneController {
  const quality = detectQuality()
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    antialias: quality.antialias,
    alpha: false,
    powerPreference: 'high-performance',
  })
  if (!renderer.getContext()) {
    throw new Error('WebGL no está disponible.')
  }
  renderer.setPixelRatio(quality.pixelRatio)
  renderer.setClearColor(0x070b14, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x070b14, 0.0038)
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 900)
  camera.position.copy(HOME_POS)

  const controls = new OrbitControls(camera, options.canvas)
  controls.target.copy(HOME_TARGET)
  controls.enableDamping = options.motion
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.rotateSpeed = 0.65
  controls.zoomSpeed = 0.7
  controls.minDistance = 16
  controls.maxDistance = 120
  options.canvas.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) event.stopPropagation()
    },
    { capture: true },
  )
  controls.minPolarAngle = 0.2
  controls.maxPolarAngle = 1.35
  controls.touches.ONE = 0
  controls.touches.TWO = 3
  controls.update()

  const decor = new THREE.Group()
  const projects = new THREE.Group()
  scene.add(decor, projects)

  const diskTexture = softDisk()
  const dust = createDisk(quality.dust, 0x51a7e1, 78, 7, '#9ecfff', 0.55, diskTexture)
  const haze = createDisk(Math.round(quality.dust * 0.35), 0x88c0de, 90, 16, '#6d5ea8', 1.15, diskTexture)
  const sky = createSky(quality.sky, diskTexture)
  decor.add(dust.points, haze.points, sky)

  const nebulaColors: Array<[string, string, number]> = [
    ['rgba(90, 190, 255, 0.20)', 'rgba(40, 80, 180, 0.05)', 120],
    ['rgba(150, 120, 255, 0.16)', 'rgba(70, 40, 140, 0.04)', 150],
    ['rgba(255, 214, 170, 0.08)', 'rgba(180, 120, 80, 0.03)', 100],
    ['rgba(80, 220, 230, 0.10)', 'rgba(20, 60, 120, 0.04)', 130],
    ['rgba(180, 140, 255, 0.10)', 'rgba(40, 20, 80, 0.03)', 110],
  ]
  const nebulaSprites: THREE.Sprite[] = []
  const nebulaRand = mulberry(0x0a11c0de)
  for (let index = 0; index < quality.nebulas; index += 1) {
    const [inner, outer, scale] = nebulaColors[index % nebulaColors.length]
    const material = new THREE.SpriteMaterial({
      map: nebulaTexture(inner, outer),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
      fog: false,
    })
    const sprite = new THREE.Sprite(material)
    const angle = nebulaRand() * Math.PI * 2
    const radius = 10 + nebulaRand() * 48
    sprite.position.set(Math.cos(angle) * radius, (nebulaRand() - 0.5) * 12, Math.sin(angle) * radius)
    sprite.scale.set(scale, scale * (0.62 + nebulaRand() * 0.3), 1)
    decor.add(sprite)
    nebulaSprites.push(sprite)
  }

  const featured = new Set(options.featuredIds)

  const layouts = buildStarLayout(options.repos)
  const byId = new Map<number, StarRecord>()
  const pickables: THREE.Sprite[] = []
  const coreCache = new Map<string, THREE.Texture>()
  const haloCache = new Map<string, THREE.Texture>()

  for (const layout of layouts) {
    const hex = colorForLanguage(layout.language)
    const coreKey = `${hex}:${layout.fork}`
    let coreMap = coreCache.get(coreKey)
    if (!coreMap) {
      coreMap = coreTexture(hex, layout.fork)
      coreCache.set(coreKey, coreMap)
    }
    let haloMap = haloCache.get(hex)
    if (!haloMap) {
      haloMap = haloTexture(hex)
      haloCache.set(hex, haloMap)
    }
    const position = new THREE.Vector3(layout.position.x, layout.position.y, layout.position.z)
    const emphasis = featured.has(layout.id) ? 1.18 : 1
    const baseHalo = 15.5 * quality.starScale * emphasis
    const baseCore = (layout.fork ? 6.4 : 5.5) * quality.starScale * emphasis
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloMap,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: layout.archived ? 0.42 : 0.95,
        fog: false,
      }),
    )
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: coreMap,
        transparent: true,
        depthWrite: false,
        opacity: layout.archived ? 0.75 : 1,
        fog: false,
      }),
    )
    halo.position.copy(position)
    core.position.copy(position)
    halo.scale.setScalar(baseHalo)
    core.scale.setScalar(baseCore)
    halo.renderOrder = 2
    core.renderOrder = 3
    halo.userData = { id: layout.id }
    core.userData = { id: layout.id }
    projects.add(halo, core)
    pickables.push(halo, core)
    byId.set(layout.id, {
      id: layout.id,
      name: layout.name,
      language: layout.language,
      archived: layout.archived,
      position,
      core,
      halo,
      baseCore,
      baseHalo,
    })
  }

  const framed = frameHome([...byId.values()].map((record) => ({
    x: record.position.x,
    y: record.position.y,
    z: record.position.z,
  })))
  const homePos = new THREE.Vector3(framed.position.x, framed.position.y, framed.position.z)
  const homeTarget = new THREE.Vector3(framed.target.x, framed.target.y, framed.target.z)
  camera.position.copy(homePos)
  controls.target.copy(homeTarget)
  controls.maxDistance = Math.max(140, camera.position.distanceTo(homeTarget) + 40)
  controls.update()

  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  let lineGeometry = new THREE.BufferGeometry()
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial)
  projects.add(lines)

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const clock = new THREE.Clock()
  let frame = 0
  let motion = options.motion
  let paused = false
  let hidden = document.hidden
  let spin = 0
  let selectedId: number | null = null
  let hoveredId: number | null = null
  let flight: Flight | null = null
  const pointers = new Set<number>()
  let origin: { x: number; y: number } | null = null
  let moved = false

  function resize() {
    const width = options.canvas.clientWidth || window.innerWidth
    const height = options.canvas.clientHeight || window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
  }

  function applyScale() {
    const focused = selectedId !== null
    for (const record of byId.values()) {
      const selected = record.id === selectedId
      const distance = Math.max(camera.position.distanceTo(record.position), 1)
      const boost = Math.min(1.55, Math.max(0.88, distance / 78))
      const factor = (selected ? 1.28 : 1) * boost
      record.core.scale.setScalar(record.baseCore * factor)
      record.halo.scale.setScalar(record.baseHalo * factor)
      const coreMaterial = record.core.material as THREE.SpriteMaterial
      const haloMaterial = record.halo.material as THREE.SpriteMaterial
      const dim = focused && !selected
      coreMaterial.opacity = dim ? 0.28 : record.archived ? 0.75 : 1
      haloMaterial.opacity = dim ? 0.12 : record.archived ? 0.42 : 0.9
    }
    lineMaterial.opacity = focused ? 0.08 : 0.28
    const atmosphere = focused ? 0.34 : 1
    for (const sprite of nebulaSprites) {
      sprite.material.opacity = 0.9 * atmosphere
    }
    const skyMaterial = sky.material as THREE.PointsMaterial
    skyMaterial.opacity = 0.8 * atmosphere
    const hazeMaterial = haze.points.material as THREE.PointsMaterial
    hazeMaterial.opacity = 0.5 * atmosphere
  }

  function rebuildLines(visible: ReadonlySet<number>) {
    const stars = [...byId.values()].map((record) => ({
      id: record.id,
      name: record.name,
      language: record.language,
      fork: false,
      archived: record.archived,
      position: { x: record.position.x, y: record.position.y, z: record.position.z },
      visible: visible.has(record.id),
    }))
    const pairs = constellationPairs(stars)
    const positions = new Float32Array(Math.max(pairs.length, 1) * 6)
    const colors = new Float32Array(Math.max(pairs.length, 1) * 6)
    pairs.forEach((pair, index) => {
      const start = byId.get(pair.a)
      const end = byId.get(pair.b)
      if (!start || !end) return
      const color = new THREE.Color(colorForLanguage(pair.language))
      const offset = index * 6
      positions.set([start.position.x, start.position.y, start.position.z, end.position.x, end.position.y, end.position.z], offset)
      colors.set([color.r, color.g, color.b, color.r, color.g, color.b], offset)
    })
    lineGeometry.dispose()
    lineGeometry = new THREE.BufferGeometry()
    if (pairs.length) {
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      lineGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    }
    lines.geometry = lineGeometry
  }

  function flyTo(position: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    if (!animate) {
      flight = null
      camera.position.copy(position)
      controls.target.copy(target)
      camera.lookAt(controls.target)
      controls.enabled = true
      controls.update()
      return
    }
    flight = {
      fromPos: camera.position.clone(),
      toPos: position.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      start: performance.now(),
      duration: 880,
    }
    controls.enabled = false
  }

  function stepFlight(now: number) {
    if (!flight) return
    const progress = Math.min(1, (now - flight.start) / flight.duration)
    const eased = progress * progress * (3 - 2 * progress)
    camera.position.lerpVectors(flight.fromPos, flight.toPos, eased)
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased)
    camera.lookAt(controls.target)
    if (progress >= 1) {
      flight = null
      controls.enabled = true
      controls.update()
    }
  }

  function abortFlight() {
    if (!flight) return
    flight = null
    controls.enabled = true
    controls.update()
  }

  function publishHover() {
    if (hoveredId === null) {
      options.onHover(null)
      options.canvas.classList.remove('over-star')
      return
    }
    const record = byId.get(hoveredId)
    if (!record || !record.halo.visible) {
      hoveredId = null
      options.onHover(null)
      options.canvas.classList.remove('over-star')
      return
    }
    const projected = record.position.clone().project(camera)
    if (projected.z > 1) {
      options.onHover(null)
      return
    }
    const rect = options.canvas.getBoundingClientRect()
    options.canvas.classList.add('over-star')
    options.onHover({
      id: record.id,
      name: record.name,
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    })
  }

  function intersect(event: PointerEvent): number | null {
    const rect = options.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(pickables, false)
    for (const hit of hits) {
      const id = hit.object.userData.id
      if (typeof id === 'number' && hit.object.visible) return id
    }
    return null
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointers.add(event.pointerId)
    abortFlight()
    if (pointers.size === 1) {
      origin = { x: event.clientX, y: event.clientY }
      moved = false
    } else {
      moved = true
    }
    options.canvas.classList.add('dragging')
  }

  function onPointerMove(event: PointerEvent) {
    if (origin) {
      const dx = event.clientX - origin.x
      const dy = event.clientY - origin.y
      if (dx * dx + dy * dy > 100) moved = true
    }
    if (moved || event.pointerType === 'touch') {
      hoveredId = null
      publishHover()
      return
    }
    hoveredId = intersect(event)
    publishHover()
  }

  function onPointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId)
    if (pointers.size > 0) return
    const wasClick = Boolean(origin) && !moved
    origin = null
    moved = false
    options.canvas.classList.remove('dragging')
    if (wasClick) {
      const id = intersect(event)
      if (id !== null) options.onSelect(id)
    }
  }

  function render(now: number) {
    const delta = Math.min(clock.getDelta(), 0.05)
    const dustMaterial = dust.points.material as THREE.PointsMaterial
    const focusDim = selectedId !== null ? 0.4 : 1
    if (motion) {
      spin += delta * 0.012
      dustMaterial.opacity = (0.5 + Math.sin(now * 0.00035) * 0.04) * focusDim
    } else {
      dustMaterial.opacity = 0.5 * focusDim
    }
    decor.rotation.y = spin
    stepFlight(now)
    if (!flight) controls.update()
    applyScale()
    publishLabels()
    if (hoveredId !== null) publishHover()
    renderer.render(scene, camera)
  }

  function publishLabels() {
    const width = options.canvas.clientWidth
    const height = options.canvas.clientHeight
    const labels: SceneLabel[] = []
    for (const id of featured) {
      const record = byId.get(id)
      if (!record) continue
      const projected = record.position.clone().project(camera)
      labels.push({
        id: record.id,
        name: record.name,
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
        visible: record.halo.visible && projected.z < 1,
      })
    }
    options.onLabels(labels)
  }

  function loop(now: number) {
    frame = window.requestAnimationFrame(loop)
    render(now)
  }

  function start() {
    if (paused || hidden) return
    cancelAnimationFrame(frame)
    clock.getDelta()
    frame = window.requestAnimationFrame(loop)
  }

  function stop() {
    cancelAnimationFrame(frame)
    frame = 0
  }

  function onVisibility() {
    hidden = document.hidden
    if (hidden) stop()
    else start()
  }

  function onLost(event: Event) {
    event.preventDefault()
    stop()
    options.onContextLost()
  }

  resize()
  rebuildLines(new Set(options.repos.map((repo) => repo.id)))
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  options.canvas.addEventListener('pointerdown', onPointerDown)
  options.canvas.addEventListener('pointermove', onPointerMove)
  options.canvas.addEventListener('pointerup', onPointerUp)
  options.canvas.addEventListener('pointercancel', onPointerUp)
  options.canvas.addEventListener('pointerleave', () => {
    hoveredId = null
    publishHover()
  })
  options.canvas.addEventListener('webglcontextlost', onLost)
  start()

  return {
    setVisible(ids) {
      for (const record of byId.values()) {
        const show = ids.has(record.id)
        record.core.visible = show
        record.halo.visible = show
      }
      rebuildLines(ids)
      if (selectedId !== null && !ids.has(selectedId)) {
        selectedId = null
        applyScale()
      }
      if (hoveredId !== null && !ids.has(hoveredId)) {
        hoveredId = null
        publishHover()
      }
    },
    focus(id, animate) {
      const record = byId.get(id)
      if (!record || !record.halo.visible) return
      selectedId = id
      applyScale()
      flyTo(record.position.clone().add(FOCUS_OFFSET), record.position.clone(), animate)
    },
    clearSelection() {
      selectedId = null
      applyScale()
    },
    resetView(animate) {
      selectedId = null
      applyScale()
      flyTo(homePos.clone(), homeTarget.clone(), animate)
    },
    setMotion(enabled) {
      motion = enabled
      controls.enableDamping = enabled
      if (!enabled) {
        const dustMaterial = dust.points.material as THREE.PointsMaterial
        dustMaterial.opacity = 0.62
        controls.update()
      }
    },
    setPaused(next) {
      paused = next
      if (next) stop()
      else start()
    },
    destroy() {
      stop()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      controls.dispose()
      renderer.dispose()
    },
  }
}

function createDisk(
  count: number,
  seed: number,
  radius: number,
  thickness: number,
  color: string,
  size: number,
  map: THREE.Texture,
): { points: THREE.Points } {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const random = mulberry(seed)
  const base = new THREE.Color(color)
  for (let index = 0; index < count; index += 1) {
    const arm = index % 2
    const along = random()
    const angle = along * Math.PI * 5.5 + arm * Math.PI + (random() - 0.5) * 0.5
    const distance = 4 + along ** 0.9 * radius
    const jitter = (random() - 0.5) * (4 + along * 10)
    positions[index * 3] = Math.cos(angle) * distance + Math.cos(angle + Math.PI / 2) * jitter
    positions[index * 3 + 1] = (random() - 0.5) * thickness * (0.35 + along)
    positions[index * 3 + 2] = Math.sin(angle) * distance + Math.sin(angle + Math.PI / 2) * jitter
    const tint = base.clone().multiplyScalar(0.45 + random() * 0.75)
    colors[index * 3] = tint.r
    colors[index * 3 + 1] = tint.g
    colors[index * 3 + 2] = tint.b
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    map,
    size,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.62,
    sizeAttenuation: true,
  })
  return { points: new THREE.Points(geometry, material) }
}

function createSky(count: number, map: THREE.Texture): THREE.Points {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const random = mulberry(0xc0ffee)
  for (let index = 0; index < count; index += 1) {
    const radius = 150 + random() * 260
    const theta = random() * Math.PI * 2
    const phi = Math.acos(2 * random() - 1)
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta)
    positions[index * 3 + 1] = radius * Math.cos(phi)
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    const warm = random() > 0.82
    const color = new THREE.Color(warm ? '#ffe7c4' : random() > 0.5 ? '#d5e7ff' : '#ffffff')
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    map,
    size: 1.15,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.8,
    sizeAttenuation: true,
    fog: false,
  })
  return new THREE.Points(geometry, material)
}
