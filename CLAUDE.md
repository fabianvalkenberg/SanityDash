# SanityDash

Persoonlijke todo-app met 4 kolommen: Inbox, Plannen, Bellen, Mailen. Gebouwd als werkend prototype, geen productie-app. Eén gebruiker, wachtwoord-auth, realtime sync via Firebase.

@./MEMORY.md

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS (geen framework, geen bundler)
- **Backend:** Vercel Serverless Functions (`/api/`)
- **Database:** Firebase Firestore (realtime sync via `onSnapshot`)
- **AI:** Claude API (Haiku) voor transcript-parsing
- **Hosting:** Vercel (`prj_Ea4wRNb8TPE1GkL9ErqJenuLaOkM`, team `team_5zDsb4UMIdxiJuDAo1Jyz2zy`)
- **Fonts:** Borna (custom, in `assets/typography/`)
- **Icons:** Custom SVG set in `assets/icons/`

## Architectuur

### Pagina's (SPA-achtig, DOM toggle)
- **Overzicht** (`pageOverzicht`) — Hoofdpagina met 4 kolommen taakkaarten
- **Invoer** (`pageInvoer`) — Textarea voor transcript → AI parsing naar taken
- **Profiel** (`pageProfiel`) — Contactenlijst beheren (komma-gescheiden)

### Data model (Firestore)
- `tasks/main` — Eén document met 4 arrays: `inbox[]`, `planning[]`, `bellen[]`, `mailen[]`
- `settings/contacts` — Contactenlijst voor naam-matching

### Taak types
- **Inbox:** `{ titel, completed }`
- **Planning:** `{ titel, uren (1|2|3|6), completed }`
- **Bellen/Mailen:** `{ naam, taak, completed }`

### API endpoints (Vercel Functions)
- `POST /api/login` — Wachtwoord check, geeft base64 token terug
- `POST /api/verify` — Token validatie
- `POST /api/parse-transcript` — Transcript → taken via Claude Haiku
- `GET|POST /api/quick-add` — Alfred/externe quick-add met slimme task parser

### Auth
- Simpele wachtwoord-auth via `APP_PASSWORD` env var
- Token = base64 van `password + '_sanitydash_auth'`
- Opgeslagen in `localStorage`

## Bestanden

```
index.html          — Hoofd-app (sidebar + 3 pagina's)
login.html          — Login scherm
app.js              — Alle frontend logica (~1040 regels)
styles.css          — Alle styling (~765 regels)
firebase.js         — Firebase wrapper (CRUD + realtime subscribe)
vercel.json         — API routing + CORS headers
api/login.js        — Login endpoint
api/verify.js       — Token verificatie
api/parse-transcript.js — AI transcript parser
api/quick-add.js    — Alfred quick-add + slimme task parser
```

## Design systeem

### Kleuren
- `--color-light-gray: #DFDFDF`
- `--color-medium-gray: #626161` (achtergrond + modal)
- `--color-dark-gray: #434343` (tekst)
- `--color-accent: #F8602D` (oranje-rood, hover, actieve states)
- `--color-white: #FFFFFF`

### Typografie
- Font: Borna (400, 500, 600, 700)
- Base: 15px, letter-spacing: -0.48px
- Modal inputs: 40px, font-weight 300

### Kaarten
- Vast formaat: 168×130px, 16px padding
- Grid: 2 breed per kolom, 1px gap
- Hover: 4px oranje inset border met bounce easing

### Interactie
- Klik → edit modal (fullscreen overlay)
- Hold 100ms → drag & drop (met rotatie, ghost preview, snap-back)
- Drop op linker zone → verwijder taak
- Drop op andere kolom → verplaats + converteer taaktype
- Completed taken: donkergrijze achtergrond, auto-cleanup na 24u

## Run & deploy

```bash
# Lokaal (via Vercel CLI)
vercel dev

# Deploy
vercel --prod
```

## Env variabelen (Vercel)
- `APP_PASSWORD` — Login wachtwoord
- `CLAUDE_API_KEY` — Anthropic API key voor transcript parsing
- `API_KEY` — Quick-add API auth key

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->
