import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { ApiError, handleCircle } from './circle'
import { ALERTS_DRY_RUN, ALERTS_ENABLED, CIRCLE_API_KEY, PORT, PUBLIC_URL } from './env'
import { confirm, runNotifier, subscribe, unsubscribe } from './alerts'

const DIST = resolve('dist')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json', '.wasm': 'application/wasm',
}
/** Serves the built site from dist/ when it exists. Unknown paths get index.html so deep links and refreshes work. */
function serveStatic(pathname: string, res: ServerResponse): boolean {
  if (!existsSync(DIST)) return false
  let file = normalize(join(DIST, decodeURIComponent(pathname)))
  if (!file.startsWith(DIST)) return false
  if (!existsSync(file) || !statSync(file).isFile()) file = join(DIST, 'index.html')
  if (!existsSync(file)) return false
  const hashed = file.includes(`${DIST}/assets/`)
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' })
  res.end(readFileSync(file))
  return true
}

const hits = new Map<string, { n: number; reset: number }>()
/** Browsers allowed to call this API from another address (comma separated). Same-origin needs no entry. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
setInterval(() => {
  const now = Date.now()
  for (const [k, h] of hits) if (h.reset < now) hits.delete(k)
}, 60_000).unref()
/** Small in-memory limiter: max `limit` calls per minute per client and route. */
function limited(req: IncomingMessage, route: string, limit: number): boolean {
  const fwd = req.headers['x-forwarded-for']
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown'
  const key = `${route}:${ip}`
  const now = Date.now()
  const h = hits.get(key)
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + 60_000 })
    return false
  }
  h.n += 1
  return h.n > limit
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
function page(res: ServerResponse, title: string, body: string) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p>`)
}
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 64_000) throw new ApiError(413, 'Request too large.')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const origin = req.headers.origin
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }
    // Links in emails must never be built from the request's Host header, which a caller controls.
    const base = PUBLIC_URL ?? (ALERTS_DRY_RUN ? url.origin : undefined)
    try {
      if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { emailWallets: Boolean(CIRCLE_API_KEY), alerts: ALERTS_ENABLED })
      if (req.method === 'POST' && url.pathname === '/api/circle') {
        if (limited(req, 'circle', 60)) throw new ApiError(429, 'Too many requests. Try again in a minute.')
        const body = await readJson(req)
        if (body.action === 'requestEmailOtp' && limited(req, 'otp', 5)) throw new ApiError(429, 'Too many codes requested. Try again in a minute.')
        return send(res, 200, await handleCircle(body))
      }
      if (req.method === 'POST' && url.pathname === '/api/alerts/subscribe') {
        if (limited(req, 'subscribe', 5)) throw new ApiError(429, 'Too many requests. Try again in a minute.')
        if (!base) throw new ApiError(503, 'Alerts are not configured on this server.')
        const body = await readJson(req)
        return send(res, 200, await subscribe(body.email, body.address, base))
      }
      if (req.method === 'GET' && url.pathname === '/api/alerts/confirm') {
        return confirm(url.searchParams.get('token') ?? '')
          ? page(res, 'Alerts confirmed', 'You will get an email when a payment unlocks or an escrow needs you.')
          : page(res, 'Link not valid', 'This confirmation link is invalid or has expired.')
      }
      if (req.method === 'GET' && url.pathname === '/api/alerts/unsubscribe') {
        return unsubscribe(url.searchParams.get('token') ?? '')
          ? page(res, 'Unsubscribed', 'You will not get any more Nodra alert emails.')
          : page(res, 'Link not valid', 'This link is invalid or you are already unsubscribed.')
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && serveStatic(url.pathname, res)) return
      return send(res, 404, { error: 'Not found' })
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.message, code: e.code })
      console.error('request failed', url.pathname, e instanceof Error ? e.message : e)
      return send(res, 500, { error: 'Something went wrong.' })
    }
  })()
})

server.listen(PORT, () => {
  console.log(`Nodra API on :${PORT} (email wallets: ${Boolean(CIRCLE_API_KEY)}, alerts: ${ALERTS_ENABLED})`)
})

if (ALERTS_ENABLED) {
  const tick = () => runNotifier(process.env.ALERTS_PUBLIC_URL ?? `http://localhost:${PORT}`).catch((e) => console.error('notifier failed', e instanceof Error ? e.message : e))
  setInterval(tick, 60_000)
  void tick()
}
