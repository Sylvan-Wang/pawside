// Maps supabase-js's /rest/v1/* paths onto a bare PostgREST (which serves at /).
// Local test harness only: see scripts/local-supabase/README.md.
import http from 'node:http'

const target = new URL(process.env.POSTGREST_URL ?? 'http://127.0.0.1:54330')
const port = Number(process.env.PROXY_PORT ?? 54331)

http.createServer((req, res) => {
  const path = (req.url ?? '/').replace(/^\/rest\/v1/, '') || '/'
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
