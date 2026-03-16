# findurlink

Local DNS API server for [findur.link](https://findur.link) — runs `dig` + `whois` lookups for accurate domain availability checking.

## Quick Start

```bash
npx findurlink
# or
bunx findurlink
```

Then open [findur.link](https://findur.link), go to **Settings** (in the filter sidebar), and select **Local API** mode.

## Requirements

- **Node.js >= 18** or **Bun >= 1.0**
- `dig` (from `dnsutils` / `bind-tools`)
- `whois`

### Install dependencies

```bash
# Debian/Ubuntu
apt install dnsutils whois

# macOS
brew install bind whois

# Termux
pkg install dnsutils whois
```

## Options

| Env Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/stream` | SSE streaming domain check |
| `POST` | `/api/check` | Batch domain check (JSON response) |
| `GET` | `/api/whois?domain=x` | Whois detail lookup |
| `GET` | `/api/pricing` | TLD pricing (Porkbun, cached 1hr) |
| `GET` | `/api/health` | Health check |

## How It Works

1. **dig** checks DNS status (NXDOMAIN = potentially available, NOERROR = taken)
2. **whois** confirms availability for NXDOMAIN domains (with retry + rate limiting)
3. Results are cached for 15 minutes to avoid hammering DNS/whois servers

## License

MIT
