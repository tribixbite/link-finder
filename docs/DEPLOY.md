# digr Deployment Guide

## Prerequisites

- **Bun** runtime (v1.0+) — [bun.sh](https://bun.sh)
- **dig** CLI tool (from `dnsutils` or `bind-tools`)
- **whois** CLI tool

On Termux:
```bash
pkg install dnsutils whois
```

On Debian/Ubuntu:
```bash
apt install dnsutils whois
```

## Development Setup

```bash
# Install dependencies
bun install

# Start dev server (port 5173, proxies /api to 3001)
bun run dev

# In a separate terminal, start the API server
bun run api
```

The dev server auto-reloads on file changes. API server must be restarted manually.

### Termux Notes

The `postinstall.sh` script patches native module resolution for Termux's Android environment:
- Symlinks `@esbuild/linux-arm64` as `android-arm64`
- Copies `@rollup/wasm-node` over the native rollup dist
- The dev server runs through `scripts/vite-cli.ts` via `bun` (not `node`) to bypass platform detection issues with lightningcss

## Build

```bash
bun run build
```

Output: `build/` directory containing static SPA files (HTML, CSS, JS).

The build uses `adapter-static` (SPA mode) — all routes resolve to `index.html`.

## Production Deployment

### Option 1: Direct

1. Build the static frontend:
   ```bash
   bun run build
   ```

2. Serve static files with any web server (nginx, caddy, etc.)

3. Run the API server:
   ```bash
   PORT=3001 bun scripts/api-server.ts
   ```

4. Configure reverse proxy to route `/api/*` to `localhost:3001`

### Nginx Example

```nginx
server {
    listen 80;
    server_name digr.example.com;

    # Static SPA
    root /path/to/digr/build;
    index index.html;
    try_files $uri $uri/ /index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;  # Required for SSE
        proxy_cache off;
    }
}
```

### Option 2: Docker

```bash
docker build -t digr .
docker run -p 3001:3001 digr
```

See `Dockerfile` and `docker-compose.yml` for details.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `NODE_ENV` | — | Set to `production` for static file serving from API |

## Health Check

```bash
curl http://localhost:3001/api/health
# {"ok":true,"pid":12345,"cacheSize":0}
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start SvelteKit dev server |
| `bun run api` | Start API server |
| `bun run build` | Build static frontend |
| `bun run preview` | Preview built frontend |
| `bun run check` | Run svelte-check (type checking) |
