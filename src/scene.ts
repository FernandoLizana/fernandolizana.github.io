import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildStarLayout, colorForLanguage, constellationPairs, frameHome, planetRadius } from './groups.ts'
import type { Repo } from './types.ts'

const HOME_POS = new THREE.Vector3(0, 12, 54)
const HOME_TARGET = new THREE.Vector3(0, 0, 0)

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
  control: THREE.Vector3
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
    dust: low ? 4200 : 15000,
    sky: low ? 500 : 1100,
    nebulas: low ? 2 : 3,
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
    gradient.addColorStop(0, hexToRgba(hex, 0.05))
    gradient.addColorStop(0.08, hexToRgba(hex, 0.85))
    gradient.addColorStop(0.2, hexToRgba(hex, 0.22))
    gradient.addColorStop(0.42, hexToRgba(hex, 0))
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
  renderer.setClearColor(0x000000, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(58, 1, 0.12, 900)
  camera.position.copy(HOME_POS)

  const controls = new OrbitControls(camera, options.canvas)
  controls.target.copy(HOME_TARGET)
  controls.enableDamping = options.motion
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.rotateSpeed = 0.65
  controls.zoomSpeed = 0.7
  controls.minDistance = 2.4
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
  const spiral = createSpiral(quality.dust, 62, diskTexture, 1.35, 0.86, {
    core: '#fff6e2',
    mid: '#ffb15a',
    rim: '#6f8dff',
  })
  const veil = createSpiral(Math.round(quality.dust * 0.28), 84, diskTexture, 2.4, 0.34, {
    core: '#ffd2ea',
    mid: '#b06bff',
    rim: '#241448',
  })
  const sparks = createSpiral(Math.round(quality.dust * 0.16), 58, diskTexture, 2.8, 0.95, {
    core: '#ffffff',
    mid: '#ffe0a8',
    rim: '#9eb6ff',
  })
  const sky = createSky(quality.sky, diskTexture)
  const coreGlow = createCoreGlow()
  decor.add(veil, spiral, sparks, sky, ...coreGlow)
  decor.rotation.x = 0.58

  const featured = new Set(options.featuredIds)
  const cockpit = createCockpit()
  const warp = createWarp(quality.dust > 8000 ? 170 : 80)
  camera.add(cockpit, warp)
  scene.add(camera)

  const layouts = buildStarLayout(options.repos)
  const maxFiles = Math.max(1, ...options.repos.map((repo) => repo.fileCount))
  const filesById = new Map(options.repos.map((repo) => [repo.id, repo.fileCount]))
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
    const counted = planetRadius(filesById.get(layout.id) ?? 0, maxFiles)
    const radius = (counted > 0 ? counted : 0.36) * quality.starScale
    const baseHalo = radius * 2.15
    const baseCore = radius
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
    const pick = new THREE.Sprite(
      new THREE.SpriteMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    )
    pick.position.copy(position)
    pick.scale.setScalar(Math.max(baseHalo, 7.5))
    pick.userData = { id: layout.id }
    projects.add(halo, core, pick)
    pickables.push(halo, core, pick)
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
  decor.position.copy(homeTarget)
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
    fitCockpit(cockpit, camera)
  }

  function applyScale() {
    const focused = selectedId !== null
    for (const record of byId.values()) {
      const selected = record.id === selectedId
      record.core.scale.setScalar(record.baseCore)
      record.halo.scale.setScalar(record.baseHalo)
      const coreMaterial = record.core.material as THREE.SpriteMaterial
      const haloMaterial = record.halo.material as THREE.SpriteMaterial
      const dim = focused && !selected
      coreMaterial.opacity = dim ? 0.28 : record.archived ? 0.75 : 1
      haloMaterial.opacity = dim ? 0.12 : record.archived ? 0.42 : 0.9
    }
    lineMaterial.opacity = focused ? 0.16 : 0.34
    const atmosphere = focused ? 0.28 : 1
    const spiralMaterial = spiral.material as THREE.PointsMaterial
    const veilMaterial = veil.material as THREE.PointsMaterial
    const sparkMaterial = sparks.material as THREE.PointsMaterial
    const skyMaterial = sky.material as THREE.PointsMaterial
    spiralMaterial.opacity = 0.86 * atmosphere
    veilMaterial.opacity = 0.34 * atmosphere
    sparkMaterial.opacity = 0.95 * atmosphere
    skyMaterial.opacity = 0.7 * atmosphere
    for (const sprite of coreGlow) {
      const base = typeof sprite.userData.baseOpacity === 'number' ? sprite.userData.baseOpacity : 0.8
      sprite.material.opacity = base * atmosphere
    }
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

  function flyTo(position: THREE.Vector3, target: THREE.Vector3, animate: boolean): number {
    if (!animate) {
      flight = null
      camera.up.set(0, 1, 0)
      camera.position.copy(position)
      controls.target.copy(target)
      camera.lookAt(controls.target)
      controls.enabled = true
      controls.update()
      return 700
    }
    const fromPos = camera.position.clone()
    const travel = fromPos.distanceTo(position)
    const duration = Math.min(2800, Math.max(1200, travel * 24))
    const control = fromPos.clone().lerp(position, 0.42)
    const side = new THREE.Vector3().crossVectors(position.clone().sub(fromPos), new THREE.Vector3(0, 1, 0))
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0)
    side.normalize()
    control.addScaledVector(side, Math.min(8, travel * 0.12))
    control.y += Math.min(4, travel * 0.05)
    flight = {
      fromPos,
      control,
      toPos: position.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      start: performance.now(),
      duration,
    }
    controls.enabled = false
    return duration
  }

  function stepFlight(now: number) {
    if (!flight) return
    const progress = Math.min(1, (now - flight.start) / flight.duration)
    const eased = progress * progress * (3 - 2 * progress)
    const left = flight.fromPos.clone().lerp(flight.control, eased)
    const right = flight.control.clone().lerp(flight.toPos, eased)
    camera.position.copy(left.lerp(right, eased))
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased)
    const bank = Math.sin(eased * Math.PI) * 0.22
    camera.up.set(Math.sin(bank), Math.cos(bank), 0)
    camera.lookAt(controls.target)
    if (progress >= 1) {
      flight = null
      camera.up.set(0, 1, 0)
      camera.lookAt(controls.target)
      controls.enabled = true
      controls.update()
    }
  }

  function abortFlight() {
    if (!flight) return
    flight = null
    camera.up.set(0, 1, 0)
    camera.lookAt(controls.target)
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
    if (motion && !flight) {
      const bob = Math.sin(now * 0.0013) * 0.004
      cockpit.position.y = bob
    } else {
      cockpit.position.y = 0
    }
    if (motion) spin += delta * 0.055
    decor.rotation.y = spin
    veil.rotation.z = -spin * 0.45
    stepFlight(now)
    const travel = flight ? Math.min(1, (now - flight.start) / flight.duration) : 0
    stepWarp(warp, delta, motion ? Math.sin(travel * Math.PI) : 0)
    if (!flight) controls.update()
    applyScale()
    if (motion) {
      const pulse = 1 + Math.sin(now * 0.0011) * 0.08
      for (const sprite of coreGlow) sprite.material.opacity *= pulse
    }
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
      flyTo(approachPosition(camera.position, record.position, record.baseCore), record.position.clone(), animate)
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
        ;(spiral.material as THREE.PointsMaterial).opacity = 0.9
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

function approachPosition(from: THREE.Vector3, planet: THREE.Vector3, radius: number): THREE.Vector3 {
  const away = from.clone().sub(planet)
  if (away.lengthSq() < 0.25) away.set(0.25, 0.18, 1)
  away.normalize()
  const gap = 11 + radius * 0.45
  const position = planet.clone().addScaledVector(away, gap)
  position.y += gap * 0.06
  return position
}

function canopyMaterial(color: number, opacity = 1): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  })
  return material
}

function canopyBar(group: THREE.Group, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  group.add(mesh)
  return mesh
}

function createCockpit(): THREE.Group {
  const group = new THREE.Group()
  const frame = canopyMaterial(0x162033)
  const lip = canopyMaterial(0xffd7a1, 0.92)
  const lamp = canopyMaterial(0xfff1d6)
  const meshes = ['left', 'right', 'top', 'bottom'].map(() => canopyBar(group, frame))
  const lips = ['left', 'right', 'top', 'bottom'].map(() => canopyBar(group, lip))
  const lamps = [0, 1, 2, 3, 4].map(() => canopyBar(group, lamp))
  group.userData = { meshes, lips, lamps }
  return group
}

function fitCockpit(group: THREE.Group, camera: THREE.PerspectiveCamera) {
  const meshes = group.userData.meshes as THREE.Mesh[]
  const lips = group.userData.lips as THREE.Mesh[]
  const lamps = group.userData.lamps as THREE.Mesh[]
  const [left, right, top, bottom] = meshes
  const [lipLeft, lipRight, lipTop, lipBottom] = lips
  const z = -0.84
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.abs(z)
  const halfW = halfH * camera.aspect
  const thickness = Math.max(halfH, halfW) * 0.2
  const lipSize = thickness * 0.08
  left.position.set(-halfW + thickness * 0.42, 0, z)
  left.scale.set(thickness, halfH * 2.05, 0.02)
  right.position.set(halfW - thickness * 0.42, 0, z)
  right.scale.set(thickness, halfH * 2.05, 0.02)
  top.position.set(0, halfH - thickness * 0.28, z)
  top.scale.set(halfW * 2.05, thickness * 0.7, 0.02)
  bottom.position.set(0, -halfH + thickness * 0.72, z)
  bottom.scale.set(halfW * 2.05, thickness * 1.7, 0.02)
  lipLeft.position.set(-halfW + thickness * 0.9, 0, z + 0.01)
  lipLeft.scale.set(lipSize, halfH * 1.7, 0.01)
  lipRight.position.set(halfW - thickness * 0.9, 0, z + 0.01)
  lipRight.scale.set(lipSize, halfH * 1.7, 0.01)
  lipTop.position.set(0, halfH - thickness * 0.62, z + 0.01)
  lipTop.scale.set(halfW * 1.7, lipSize, 0.01)
  lipBottom.position.set(0, -halfH + thickness * 1.52, z + 0.01)
  lipBottom.scale.set(halfW * 1.7, lipSize, 0.01)
  lamps.forEach((item, index) => {
    item.position.set((index - 2) * thickness * 0.85, -halfH + thickness * 0.72, z + 0.02)
    item.scale.set(thickness * 0.28, thickness * 0.07, 0.01)
  })
}

function createWarp(count: number): THREE.LineSegments {
  const positions = new Float32Array(count * 6)
  const lengths = new Float32Array(count)
  const random = mulberry(0x5eed17)
  for (let index = 0; index < count; index += 1) {
    const x = (random() - 0.5) * 26
    const y = (random() - 0.5) * 15
    const z = -3 - random() * 68
    const length = 1.4 + random() * 5.5
    lengths[index] = length
    const offset = index * 6
    positions[offset] = x
    positions[offset + 1] = y
    positions[offset + 2] = z
    positions[offset + 3] = x
    positions[offset + 4] = y
    positions[offset + 5] = z - length
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.LineBasicMaterial({
    color: 0xffe2b0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false
  lines.userData.lengths = lengths
  return lines
}

function stepWarp(lines: THREE.LineSegments, delta: number, boost: number) {
  const material = lines.material as THREE.LineBasicMaterial
  const rushing = boost > 0.04
  material.opacity = rushing ? 0.14 + boost * 0.72 : 0
  if (!rushing) return
  const speed = 18 + boost * 78
  const attribute = lines.geometry.getAttribute('position') as THREE.BufferAttribute
  const lengths = lines.userData.lengths as Float32Array
  for (let index = 0; index < lengths.length; index += 1) {
    const vertex = index * 2
    const x = attribute.getX(vertex)
    const y = attribute.getY(vertex)
    let z = attribute.getZ(vertex) + delta * speed
    if (z > -1.1) z = -48 - Math.random() * 28
    const length = lengths[index] * (1 + boost * 2.6)
    attribute.setXYZ(vertex, x, y, z)
    attribute.setXYZ(vertex + 1, x, y, z - length)
  }
  attribute.needsUpdate = true
}

function createSpiral(
  count: number,
  radius: number,
  map: THREE.Texture,
  size = 1.15,
  opacity = 0.78,
  palette: { core: string; mid: string; rim: string } = {
    core: '#fff4dc',
    mid: '#ffb15a',
    rim: '#6f8dff',
  },
): THREE.Points {
  const arms = 4
  const twist = 4.6
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const random = mulberry(0x51a7e1 ^ count)
  const core = new THREE.Color(palette.core)
  const mid = new THREE.Color(palette.mid)
  const rim = new THREE.Color(palette.rim)
  for (let index = 0; index < count; index += 1) {
    const along = random() < 0.42 ? random() ** 1.65 : random()
    const arm = index % arms
    const spread = 0.08 + along * 0.26
    const angle = arm * ((Math.PI * 2) / arms) + along * twist + (random() - 0.5) * spread
    const distance = 2.5 + along * radius
    const lift = (random() - 0.5) * (0.7 + along * 2.4)
    positions[index * 3] = Math.cos(angle) * distance
    positions[index * 3 + 1] = lift
    positions[index * 3 + 2] = Math.sin(angle) * distance
    const color = new THREE.Color()
    if (along < 0.18) color.copy(core).lerp(mid, along / 0.18)
    else color.copy(mid).lerp(rim, (along - 0.18) / 0.82)
    color.multiplyScalar(0.72 + random() * 0.45)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
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
    opacity,
    sizeAttenuation: true,
    fog: false,
  })
  return new THREE.Points(geometry, material)
}

function createCoreGlow(): THREE.Sprite[] {
  const layers: Array<[string, string, number, number]> = [
    ['rgba(255,250,240,0.98)', 'rgba(255,186,90,0)', 13, 1],
    ['rgba(255,140,50,0.72)', 'rgba(70,110,255,0)', 30, 0.5],
    ['rgba(120,70,190,0.24)', 'rgba(0,0,0,0)', 54, 0.26],
  ]
  return layers.map(([inner, outer, scale, opacity]) => {
    const material = new THREE.SpriteMaterial({
      map: nebulaTexture(inner, outer),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity,
      fog: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(scale, scale, 1)
    sprite.userData.baseOpacity = opacity
    return sprite
  })
}

function createSky(count: number, map: THREE.Texture): THREE.Points {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const random = mulberry(0xc0ffee)
  for (let index = 0; index < count; index += 1) {
    const radius = 180 + random() * 320
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
    size: 0.85,
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
