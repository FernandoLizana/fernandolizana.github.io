import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile, cp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'docs', 'capturas')
const preview = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173/'
const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

function edgePath() {
  return edgeCandidates.find((candidate) => fs.existsSync(candidate))
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    httpRequest(url, (response) => {
      let body = ''
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode} en ${url}`))
          return
        }
        resolve(body ? JSON.parse(body) : {})
      })
    }).on('error', reject).end()
  })
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.next = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      }
    })
  }

  send(method, params = {}) {
    const id = this.next
    this.next += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Error en la página')
    }
    return result.result?.value
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(file, Buffer.from(data, 'base64'))
  }
}

async function waitFor(check, label) {
  const started = Date.now()
  while (Date.now() - started < 15000) {
    try {
      if (await check()) return
    } catch {
      /* el puerto todavía no responde */
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Tiempo agotado: ${label}`)
}

function staticServer(directory, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`)
    let filePath = path.join(directory, decodeURIComponent(url.pathname))
    if (filePath.endsWith(path.sep)) filePath = path.join(filePath, 'index.html')
    if (!filePath.startsWith(directory)) {
      response.writeHead(403)
      response.end()
      return
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' })
      response.end(data)
    })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

const edge = edgePath()
if (!edge) {
  console.error('No se encontró Microsoft Edge para las capturas.')
  process.exitCode = 1
} else {
  await mkdir(outDir, { recursive: true })
  const profile = path.join(os.tmpdir(), `universo-edge-${Date.now()}`)
  await rm(profile, { recursive: true, force: true })
  const child = spawn(edge, [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=9333',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' })

  try {
    await waitFor(async () => {
      await getJson('http://127.0.0.1:9333/json/version')
      return true
    }, 'Edge')
    const version = await getJson('http://127.0.0.1:9333/json/version')
    const browserWs = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      browserWs.addEventListener('open', resolve)
      browserWs.addEventListener('error', reject)
    })
    const browser = new Cdp(browserWs)
    const created = await browser.send('Target.createTarget', { url: preview })
    const targets = await getJson('http://127.0.0.1:9333/json/list')
    const tab = targets.find((item) => item.id === created.targetId)
    if (!tab?.webSocketDebuggerUrl) throw new Error('Edge no abrió la página del portafolio.')
    const ws = new WebSocket(tab.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', reject)
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await cdp.send('Page.navigate', { url: preview })
    await waitFor(() => cdp.evaluate("document.querySelector('#count')?.textContent?.includes('en total')"), 'catálogo')
    await new Promise((resolve) => setTimeout(resolve, 700))
    await cdp.screenshot(path.join(outDir, 'escritorio.png'))

    const opened = await cdp.evaluate(`(() => {
      const canvas = document.querySelector('#galaxy')
      const click = (x, y) => {
        const down = { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', bubbles: true, button: 0, buttons: 1, isPrimary: true }
        canvas.dispatchEvent(new PointerEvent('pointerdown', down))
        canvas.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, down, { buttons: 0 })))
        return document.querySelector('#detail')?.hidden === false
      }
      for (let y = 180; y <= 820; y += 36) {
        for (let x = 40; x <= 1400; x += 36) {
          if (!click(x, y)) continue
          return {
            open: true,
            title: document.querySelector('#detail-title')?.textContent,
            href: document.querySelector('#detail-repo')?.href,
            homeHidden: document.querySelector('#detail-home')?.hidden,
            homeDisplay: getComputedStyle(document.querySelector('#detail-home')).display,
            flags: document.querySelector('#detail-flags')?.textContent,
            meta: document.querySelector('#detail-meta')?.innerText,
          }
        }
      }
      return { open: false }
    })()`)
    if (opened.homeHidden && opened.homeDisplay !== 'none') {
      throw new Error('El botón Visitar proyecto aparece aunque no hay una URL válida.')
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await cdp.screenshot(path.join(outDir, 'ficha.png'))

    const search = await cdp.evaluate(`(() => {
      const input = document.querySelector('#q')
      input.value = 'leucode'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const option = document.querySelector('#search-results [role="option"]')
      option?.click()
      return {
        count: document.querySelector('#count')?.textContent,
        title: document.querySelector('#detail-title')?.textContent,
        href: document.querySelector('#detail-repo')?.href,
        optionText: option?.textContent ?? null,
      }
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await cdp.screenshot(path.join(outDir, 'busqueda.png'))

    const filters = await cdp.evaluate(`(() => {
      document.querySelector('#q').value = ''
      document.querySelector('#q').dispatchEvent(new Event('input', { bubbles: true }))
      const fork = document.querySelector('#fork-filter')
      fork.value = 'only'
      fork.dispatchEvent(new Event('change', { bubbles: true }))
      const onlyForks = document.querySelector('#count')?.textContent
      fork.value = 'all'
      fork.dispatchEvent(new Event('change', { bubbles: true }))
      const archived = document.querySelector('#archived-filter')
      archived.value = 'only'
      archived.dispatchEvent(new Event('change', { bubbles: true }))
      const archivedOnly = document.querySelector('#count')?.textContent
      archived.value = 'all'
      archived.dispatchEvent(new Event('change', { bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const closed = document.querySelector('#detail')?.hidden
      document.querySelector('#reset-view').click()
      document.querySelector('#view-toggle').click()
      const links = [...document.querySelectorAll('#list-items a')].map((anchor) => anchor.href)
      return { onlyForks, archivedOnly, closed, listHidden: document.querySelector('#lista').hidden, links }
    })()`)

    await cdp.screenshot(path.join(outDir, 'lista.png'))

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await cdp.evaluate(`document.querySelector('#view-toggle').click()`)
    await cdp.evaluate("window.dispatchEvent(new Event('resize'))")
    await new Promise((resolve) => setTimeout(resolve, 500))
    await cdp.screenshot(path.join(outDir, 'movil.png'))

    const report = { opened, search, filters }
    await writeFile(path.join(outDir, 'verificacion.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    ws.close()
    browserWs.close()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    child.kill()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  const hostRoot = path.join(os.tmpdir(), `universo-pages-${Date.now()}`)
  await rm(hostRoot, { recursive: true, force: true })
  await mkdir(path.join(hostRoot, 'universo'), { recursive: true })
  await cp(path.join(root, 'dist'), path.join(hostRoot, 'universo'), { recursive: true })
  const server = await staticServer(hostRoot, 4185)
  try {
    const html = await getJson('http://127.0.0.1:4185/universo/catalog.json')
    if (html.complete !== true || html.count !== html.repos?.length || html.fetchedCount !== html.publicRepos) {
      throw new Error('El catálogo publicado en la subruta no es el catálogo completo.')
    }
    if (html.fetchedCount !== html.count + html.excludedCount) {
      throw new Error('El catálogo publicado no cuadra con los repositorios excluidos.')
    }
    const page = await new Promise((resolve, reject) => {
      httpRequest('http://127.0.0.1:4185/universo/', (response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolve(body))
      }).on('error', reject).end()
    })
    const asset = page.match(/\.\/assets\/[^"]+\.js/)
    if (!asset) throw new Error('El HTML no referencia assets relativos.')
    await new Promise((resolve, reject) => {
      httpRequest(`http://127.0.0.1:4185/universo/${asset[0].slice(2)}`, (response) => {
        if (response.statusCode !== 200) reject(new Error(`Asset ${asset[0]} respondió ${response.statusCode}`))
        else resolve()
        response.resume()
      }).on('error', reject).end()
    })
    console.log(`Subruta /universo/ correcta. Catálogo: ${html.count} repositorios. Asset: ${asset[0]}`)
  } finally {
    server.close()
    await rm(hostRoot, { recursive: true, force: true })
  }
}
