// Stand-in for the pieces of Supabase the app talks to, in front of a bare PostgREST:
//   /rest/v1/*     -> PostgREST (path prefix removed)
//   /auth/v1/user  -> answers for any well-formed bearer token (the app's server asks "who is this?")
// Local test harness only: see scripts/local-supabase/README.md. It does NOT verify tokens.
import http from 'node:http'

const target = new URL(process.env.POSTGREST_URL ?? 'http://127.0.0.1:54330')
const port = Number(process.env.PROXY_PORT ?? 54331)

function userFor(authorization) {
  const token = (authorization ?? '').replace(/^Bearer\s+/i, '')
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    if (!claims.sub) return null
    return {
      id: claims.sub,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${claims.sub}@pawside.test`,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

http.createServer((req, res) => {
  const url = req.url ?? '/'
  if (url.startsWith('/auth/v1/user')) {
    const user = userFor(req.headers.authorization)
    res.writeHead(user ? 200 : 401, { 'content-type': 'application/json' })
    res.end(JSON.stringify(user ?? { message: 'invalid token' }))
    return
  }
  const path = url.replace(/^\/rest\/v1/, '') || '/'
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, path, method: req.method, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    },
  )
  upstream.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(upstream)
}).listen(port, '127.0.0.1', () => console.log(`proxy ${port} -> ${target.origin}`))
