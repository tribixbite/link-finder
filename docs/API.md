# digr API Reference

Base URL: `http://localhost:3001` (proxied at `/api` during development)

## Endpoints

### POST /api/stream

Stream domain availability checks via Server-Sent Events.

**Request:**
```json
{
  "domains": ["torch.dev", "torch.app", "torchr.io"]
}
```

**Constraints:**
- Max 500 domains per request
- Domains must match `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/i`
- Invalid domains silently filtered out

**SSE Event Format:**
```
data: {"type":"start","total":3}

data: {"type":"result","domain":"torch.dev","records":[],"status":"available","method":"whois","progress":1}

data: {"type":"result","domain":"torch.app","records":["172.67.182.31"],"status":"taken","method":"dig","progress":2}

data: {"type":"done","total":3}
```

**Event Types:**

| type | Fields | Description |
|------|--------|-------------|
| `start` | `total` | Stream started, total domain count |
| `result` | `domain`, `records`, `status`, `method`, `error?`, `progress` | Single domain result |
| `done` | `total` | All domains checked |

**Status Values:**
- `available` — NXDOMAIN confirmed by whois
- `taken` — DNS records found or whois confirms registration
- `reserved` — whois indicates registry-reserved domain
- `error` — check failed after retries

**Abort Behavior:** When the client disconnects (closes tab), the server detects `req.signal.aborted` and stops processing remaining domains.

---

### POST /api/check

Batch domain availability check (returns all at once).

**Request:**
```json
{
  "domains": ["torch.dev", "torchr.io"]
}
```

**Response:**
```json
{
  "results": [
    {
      "domain": "torch.dev",
      "records": [],
      "status": "available",
      "method": "whois"
    },
    {
      "domain": "torchr.io",
      "records": ["76.76.21.21"],
      "status": "taken",
      "method": "dig"
    }
  ]
}
```

Same constraints and status values as `/api/stream`.

---

### GET /api/pricing

Fetch TLD registration and renewal pricing (sourced from Porkbun public API).

**Response:**
```json
{
  "pricing": {
    "com": { "registration": "9.73", "renewal": "10.18" },
    "dev": { "registration": "12.56", "renewal": "12.56" },
    "io":  { "registration": "33.58", "renewal": "33.58" }
  },
  "registrars": {
    "porkbun": ["com", "dev", "io", ...],
    "namecheap": ["com", "dev", "io", ...],
    "spaceship": ["com", "dev", "io", ...],
    "cloudflare": ["com", "dev", "io", ...]
  }
}
```

**Caching:** 1-hour TTL. Concurrent fetches are deduplicated.

---

### GET /api/whois

Fetch detailed whois data for a single domain.

**Query Parameters:**
- `domain` (required) — must match valid domain pattern

**Response:**
```json
{
  "domain": "torch.dev",
  "raw": "Domain Name: torch.dev\nRegistrar: ...",
  "parsed": {
    "registrar": "Google LLC",
    "created": "2019-03-01T00:00:00Z",
    "expires": "2026-03-01T00:00:00Z",
    "updated": "2025-02-15T00:00:00Z",
    "nameservers": ["ns1.example.com", "ns2.example.com"],
    "status": ["clientTransferProhibited"]
  },
  "fetchedAt": 1710400000000
}
```

**Rate Limiting:** Uses the same whois semaphore (4 concurrent) and per-TLD cooldown (500ms).

---

### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "pid": 12345,
  "cacheSize": 42
}
```

---

## Rate Limiting & Concurrency

| Resource | Limit | Notes |
|----------|-------|-------|
| Concurrent dig processes | 12 | Parallel DNS lookups |
| Concurrent whois processes | 4 | Whois servers rate-limit aggressively |
| Per-TLD whois cooldown | 500ms | Prevents triggering per-TLD rate limits |
| Whois retries | 3 attempts | Exponential backoff: 1s, 2s, 4s |
| Dig timeout | 5s | Process killed after timeout |
| Whois timeout | 8s | Process killed after timeout |
| Domains per request | 500 max | Hard limit |

## Caching

### Result Cache (Server-Side)

- **TTL:** 15 minutes
- **Scope:** Per-domain, only successful results (not errors)
- **Cleanup:** Every 5 minutes, expired entries pruned
- **Dedup:** Concurrent checks for the same domain share a single Promise

### Pricing Cache

- **TTL:** 1 hour
- **Source:** Porkbun public API (`/api/json/v3/domain/pricing`)
- **Pre-warmed:** Fetched on server startup

## Two-Phase Availability Algorithm

```
1. dig +noall +comments +answer +time=3 +tries=1 <domain>
   ├── NXDOMAIN status → proceed to whois
   ├── Records in answer section → TAKEN
   └── NOERROR with no records → TAKEN (registered, no A records)

2. whois <domain>  (only for NXDOMAIN domains)
   ├── Match WHOIS_AVAILABLE_PATTERNS → AVAILABLE
   ├── Match WHOIS_RESERVED_PATTERNS → RESERVED
   ├── Match WHOIS_REGISTERED_PATTERNS → TAKEN
   ├── Long output (>50 chars) → TAKEN (conservative)
   └── Error after 3 retries → AVAILABLE (NXDOMAIN is strong signal)
```

## Error Responses

All error responses use standard JSON format:
```json
{ "error": "description of error" }
```

| Status | Condition |
|--------|-----------|
| 400 | Missing `domains` array or no valid domains |
| 404 | Unknown endpoint |
| 429 | Per-IP rate limit exceeded (100 req/min) |

## Per-IP Rate Limiting

All `/api/*` routes except `/api/health` are rate-limited to **100 requests per minute per IP**. The IP is read from `X-Forwarded-For` (first entry) or `X-Real-IP` headers, falling back to `'unknown'`.

Rate limit entries are cleaned up every 2 minutes. When exceeded, the server returns:
```json
{ "error": "Rate limit exceeded. Try again later." }
```

## Production Static Serving

When `NODE_ENV=production`, the API server also serves static files from `build/`:
- Hashed assets (`.js`, `.css`, etc.) get `Cache-Control: public, max-age=31536000, immutable`
- Non-file routes fall back to `index.html` (SPA routing)
- Configure via `CORS_ORIGIN` env var for cross-origin requests
