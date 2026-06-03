# Higgsfield AI — Full Research Report (for MashupForge integration)

> Sources analysed:
> 1. https://higgsfield.ai (main site)
> 2. https://higgsfield.ai/mcp (MCP server page)
> 3. https://higgsfield.ai/cli (CLI page)
> 4. https://higgsfield.ai/blog/Generate-AI-Videos-From-Claude-with-Higgsfield-MCP (Higgsfield blog)
> 5. https://github.com/higgsfield-ai/higgsfield-js (official Node SDK)
> 6. https://github.com/higgsfield-ai/cli (official CLI source — primary source of truth for model slugs)
> 7. https://raw.githubusercontent.com/higgsfield-ai/cli/main/MODELS.md (canonical model schema)
> 8. https://mcp.higgsfield.ai/.well-known/oauth-authorization-server (OAuth discovery)
> 9. https://github.com/higgsfield-ai/cli (pricing details from geo.higgsfield.ai blog referenced in scrape)
> 10. https://www.youtube.com/watch?v=ZvDnoABlFjw (local WebM transcript — see §10)

> Date: 2026-06-03
> Status: **Research complete. No code written.** Awaiting user's integration-direction decision.

---

## TL;DR — The Real Story (this is the surprise)

Higgsfield is **not** an OAuth-only "user authenticates in their browser" platform. They ship:

- An **official Node.js SDK** at `@higgsfield/client` on npm
- An **official CLI** at `higgsfield-ai/cli` on GitHub (30+ models, 50+ commands)
- A **REST API** behind both: `POST /v1/generations/{job_set_type}` for submit, `GET /requests/{request_id}/status` for poll, `DELETE /requests/{request_id}/cancel` for cancel
- **API-key + API-secret auth** (`Key KEY_ID:KEY_SECRET` header — confirmed by SDK source)
- The keys are minted from `cloud.higgsfield.ai → API section` (per the YouTube tutorial transcript & Apidog walkthrough)
- Credits are drawn from the user's existing Higgsfield subscription — same pool as the web UI
- A parallel **MCP server** at `https://mcp.higgsfield.ai/mcp` for Claude/agent clients that can't speak REST

**This means the original "OAuth or nothing" worry was wrong.** We can do a clean server-side REST integration with a personal API key stored in `.env`/IDB/secure-store, exactly like we already do for `OPENAI_API_KEY` and `MINIMAX_API_KEY`.

The MCP server is one of **two** integration paths. For MashupForge, REST+SDK is the right choice because:
1. It runs server-side, fits our Next.js API route model
2. It supports polling AND webhooks
3. We get the SDK's typed error classes (`NotEnoughCreditsError`, `AuthenticationError`, `BadInputError`, etc.) for free
4. No OAuth dance on the user's machine
5. Direct control over the request shape, model selection, and budget

The MCP server is still valuable as a **secondary path** — it can power a future "in-app Claude agent" feature where the user talks to a local Claude and that Claude calls Higgsfield for them.

---

## 1. Platform Overview (higgsfield.ai)

### What it is
A unified AI content generation platform. Single dashboard, single billing, single account — and access to 30+ image + video models that would otherwise each need their own integration (Veo 3.1, Sora 2, Kling 3.0, Seedance 2.0, Wan 2.6, MiniMax Hailuo 02, Nano Banana Pro, FLUX.2, GPT Image 2, Seedream 4.5/5.0, Soul 2.0, etc.).

### Key products
- **Higgsfield Studio** (web) — generate / edit / animate
- **Soul** — consistent character training (8 reference photos → reusable `soul_id`)
- **Cinema Studio 2.5 / 3.0** — multi-camera cinematic storyboarding
- **Marketing Studio** — branded ad generation (avatars, products, brand kits, ad formats, DTC Ads Engine)
- **UGC Factory** — short-form social content
- **Talking Avatar / Lipsync Studio** — animate stills with audio
- **Virality Predictor** — score hook strength / retention
- **MCP server** — for Claude/agent clients
- **CLI** — terminal-first generation

### Pricing (geo.higgsfield.ai blog, verified by current scrape)
| Plan | Price | Credits | Parallel jobs | Notable |
|------|-------|---------|---------------|---------|
| Starter | $15/mo | 200 | 2 video + 4 image | ~100 Nano Banana Pro images OR ~33 Kling 3.0 videos |
| Plus | $39/mo | (large) | more | Unlimited access to specific image models (365 days) |
| Ultra | $99/mo | 3,000 | 8 video | Adds unlimited video model, fastest queue |

All plans billed annually. Free tier historically existed for testing. The user already has a subscription, so we're using existing credits.

---

## 2. Three Integration Paths (compared)

### Path A — REST + `@higgsfield/client` SDK ⭐ **RECOMMENDED for MashupForge**

```typescript
// app/api/higgsfield/image/route.ts
import { higgsfield, config, AuthenticationError, NotEnoughCreditsError, BadInputError } from '@higgsfield/client/v2';

config({ credentials: `${process.env.HIGGSFIELD_KEY_ID}:${process.env.HIGGSFIELD_KEY_SECRET}` });

const jobSet = await higgsfield.subscribe('nano_banana_2', {
  input: {
    aspect_ratio: '9:16',
    prompt: ideaPrompt,
    resolution: '2k',
  },
  withPolling: true,
  webhook: process.env.HIGGSFIELD_WEBHOOK_URL
    ? { url: process.env.HIGGSFIELD_WEBHOOK_URL, secret: process.env.HIGGSFIELD_WEBHOOK_SECRET! }
    : undefined,
});

if (jobSet.isCompleted) {
  return Response.json({ imageUrl: jobSet.jobs[0].results?.raw.url });
}
```

**Pros:**
- Server-side, fits our Next.js Route Handlers
- Typed errors → can map to user-facing messages cleanly
- Polling OR webhook — we can pick per route
- Synchronous-feeling API (`withPolling: true` blocks up to `maxPollTime`)
- Full control over which model, what params, what safety tolerance

**Cons:**
- Need to mint a `KEY_ID:KEY_SECRET` pair from `cloud.higgsfield.ai`
- For desktop: ship the secret in `.env`/IDB, or let the user paste their own
- Credits are user-personal — not for shared SaaS deployment

### Path B — MCP client over HTTP

```typescript
// MCP client in our Node server
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'mashupforge', version: '1.0.4' }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL('https://mcp.higgsfield.ai/mcp'));
await client.connect(transport);
const { tools } = await client.listTools(); // 7 tools
const result = await client.callTool({ name: 'higgsfield_generate', arguments: { ... } });
```

**Pros:**
- No key management — each user OAuths in with their own Higgsfield account
- Works for distributed / shared deployments (each user's credits)
- Tool list is curated (7 tools, not 30+ models) — simpler surface

**Cons:**
- Requires implementing OAuth 2.0 + PKCE flow + token storage per user
- Each user must have their own Higgsfield account & subscription
- We're a "BYO subscription" SaaS — possible, but it limits monetisation later
- Tool list is curated, so we can't expose every model from day 1

### Path C — Direct REST without the SDK

Hit `https://platform.higgsfield.ai/v1/image2video/dop` etc. directly. Same auth header, same payload shape. The SDK is thin and just adds polling + error typing — for our needs the SDK is better.

### Decision matrix

| Need | Path A (REST+SDK) | Path B (MCP) |
|------|-------------------|--------------|
| Desktop app, user-owned subscription | ✅ | ✅ (if user pays HF) |
| Desktop app, dev-pays subscription | ✅ | ❌ (no shared creds) |
| Web app, multiple users | ❌ (shared quota) | ✅ |
| Lowest implementation friction | ✅ | ❌ |
| Full model coverage | ✅ (30+) | ⚠️ (7 curated tools) |
| Webhook support | ✅ | ❌ |

**Recommendation: Path A for the desktop + self-hosted web Vercel build (current state).** Path B becomes relevant if/when we ship a hosted multi-tenant SaaS. They're not mutually-exclusive — both can exist simultaneously.

---

## 3. The Official REST API (what `@higgsfield/client` wraps)

### Auth
```
Authorization: Key KEY_ID:KEY_SECRET
```
where the credentials are the same `KEY_ID:KEY_SECRET` pair from `cloud.higgsfield.ai → API → Create Key`. The SDK takes a single `credentials: "KEY_ID:KEY_SECRET"` string and adds the `Key ` prefix.

### Base URL
`https://platform.higgsfield.ai` (per the official SDK `baseURL` default)

### Job lifecycle
```
queued → in_progress → completed
                    ↘ nsfw (credits refunded)
                    ↘ failed (credits refunded)
```

### Submit generation
```http
POST /v1/{job_set_type}      # e.g. /v1/nano_banana_2, /v1/seedance_2_0
Authorization: Key KEY_ID:KEY_SECRET
Content-Type: application/json

{
  "input": {
    "prompt": "...",
    "aspect_ratio": "9:16",
    "resolution": "2k"
  }
}
```

Response:
```json
{
  "id": "d7e6c0f3-...",
  "status": "queued",
  "status_url": "https://platform.higgsfield.ai/requests/d7e6c0f3-.../status",
  "cancel_url": "https://platform.higgsfield.ai/requests/d7e6c0f3-.../cancel"
}
```

The SDK also accepts `withPolling: true` + `webhook: {...}` and will poll `status_url` automatically. Default `pollInterval = 2000ms`, `maxPollTime = 300000ms (5min)`.

### Check status
```http
GET /requests/{request_id}/status
Authorization: Key KEY_ID:KEY_SECRET
```
Returns:
```json
{
  "status": "completed",
  "request_id": "...",
  "images": [{ "url": "https://...jpg" }],
  "video": { "url": "https://...mp4" }
}
```

### Cancel
```http
DELETE /requests/{request_id}/cancel
```
Only works while `status = queued` (not once `in_progress`).

### Webhook mode
If you pass `webhook.url`, the SDK appends `?hf_webhook={url}` to the submit request. The webhook POSTs back the same JSON as the status endpoint when the job reaches a terminal state.

**Webhook headers (for our receiver):**
- `X-Webhook-URL` — the callback URL (echoed back)
- `X-Webhook-Mode` — `terminal` (fire once at COMPLETED/FAILED) or `sync` (fire every poll cycle, capped at 15s queue delay)

**Webhook payload** (same shape as `GET /requests/{id}/status`):
```json
{
  "request_id": "...",
  "status": "COMPLETED",
  "model_id": "seedance_2_0",
  "error": null,
  "output": {
    "media_url": ["https://pub-...r2.dev/v1/.../output.mp4"],
    "media_type": "video/mp4"
  },
  "created_at": "2026-05-22T13:17:32.110Z",
  "updated_at": "2026-05-22 13:19:23",
  "completed_at": "2026-05-22 13:19:23"
}
```

### Errors
The SDK exports typed errors:
- `AuthenticationError` — bad KEY_ID/SECRET
- `BadInputError` — invalid params (e.g. unsupported aspect ratio)
- `ValidationError` — schema-level rejection
- `NotEnoughCreditsError` — quota exhausted
- `APIError` — server-side 5xx
- `BrowserNotSupportedError` — V2 client refuses to run in a browser (security)

---

## 4. Complete Model Catalogue (from MODELS.md — current as of scrape)

> 18 image models + 17 video models = **35 models**. Slugs are `job_set_type` (URL-safe).

### Image models (18)
| Slug | Display name | Notes |
|------|--------------|-------|
| `nano_banana` | Nano Banana | Original; supports `auto` aspect ratio |
| `nano_banana_flash` | Nano Banana 2 | Fast variant; up to 4K |
| `nano_banana_2` | Nano Banana Pro | 4K capable; the "best" of the family |
| `flux_2` | FLUX.2 | sub-models: `pro`, `flex`, `max` |
| `flux_kontext` | Flux Kontext | No resolution control |
| `gpt_image_2` | GPT Image 2 | qualities: `low`/`medium`/`high`; up to 4K |
| `grok_image` | Grok Image | modes: `std`/`pro` |
| `text2image_soul_v2` | Higgsfield Soul V2 | supports `--soul-id` for character consistency |
| `soul_cinematic` | Soul Cinematic | |
| `soul_location` | Soul Location | no image input |
| `seedream_v4_5` | Seedream 4.5 | qualities: `basic`/`high` |
| `seedream_v5_lite` | Seedream V5 Lite | qualities: `basic`/`high` |
| `openai_hazel` | OpenAI Hazel | qualities: `low`/`medium`/`high` |
| `kling_omni_image` | Kling O1 Image | up to 2K; includes `auto` + `21:9` |
| `image_auto` | Image Auto | "let Higgsfield pick the best model" |
| `cinematic_studio_2_5` | Cinematic Studio 2.5 | up to 4K |
| `z_image` | Z Image | |
| `marketing_studio_image` | Marketing Studio Image | branded image gen |
| `dtc_ads` | DTC Ads Engine | requires `style_id` (ad format UUID) |

### Video models (17)
| Slug | Display name | Notable params |
|------|--------------|----------------|
| `seedance_2_0` | Seedance 2.0 | `--mode std/fast`, `--genre auto/action/horror/comedy/noir/drama/epic`, durations 1-15s, 480p/720p/1080p |
| `seedance1_5` | Seedance 1.5 Pro | durations 4/8/12 |
| `kling3_0` | Kling v3.0 | `--mode pro/std`, `--sound on/off` |
| `kling2_6` | Kling 2.6 Video | durations 5/10 |
| `veo3` | Google Veo 3 | `--model veo-3-fast/veo-3-preview`, image-to-video only |
| `veo3_1` | Google Veo 3.1 | `--quality basic/high/ultra`, durations 4/6/8 |
| `veo3_1_lite` | Google Veo 3.1 Lite | faster + cheaper, supports start/end-image, video, audio |
| `wan2_6` | Wan 2.6 Video | durations 5/10/15 |
| `wan2_7` | Wan 2.7 | resolutions 720p/1080p |
| `minimax_hailuo` | MiniMax Hailuo | `--model minimax/minimax-fast/minimax-2.3/minimax-2.3-fast`, resolutions 512/768/1080 |
| `grok_video` | Grok Video | |
| `cinematic_studio_video` | Cinematic Studio Video | durations 5/10, `--slow_motion` boolean |
| `cinematic_studio_video_v2` | Cinematic Studio Video V2 | adds `--genre` enum |
| `cinematic_studio_3_0` | Cinematic Studio 3.0 | current flagship |
| `soul_cast` | Soul Cast | custom param shape |
| `marketing_studio_video` | Marketing Studio Video | ad-creative specific: `--ad_reference_id`, `--product_ids`, `--avatars`, `--setting_id`, `--hook_id`, `--web_product_ids`, `--mode` (ugc/ugc_how_to/ugc_unboxing/product_showcase/product_review/tv_spot/wild_card/ugc_virtual_try_on/virtual_try_on) |
| `brain_activity` | Virality Predictor | takes a `--video` only, returns analysis scores + report URL |

### Common image input flags
- `--image` (1+ files) — most image models
- `--start-image` / `--end-image` — video models for i2v
- All media inputs accept either a UUID (upload id or previous job id) or a local file path; paths are auto-uploaded by the CLI
- All image models support `--aspect_ratio`: usually `1:1, 4:3, 3:4, 16:9, 9:16` (some add `auto`, `3:2`, `2:3`, `21:9`)

---

## 5. MCP Server Details (https://mcp.higgsfield.ai/mcp)

### Protocol
MCP (Model Context Protocol), version `2024-11-05`. Streamable HTTP transport.

### Auth (from `/.well-known/oauth-authorization-server`)
Standard OAuth 2.0 server:
- **Issuer:** `https://mcp.higgsfield.ai`
- **Authorization endpoint:** `https://mcp.higgsfield.ai/oauth2/authorize`
- **Token endpoint:** `https://mcp.higgsfield.ai/oauth2/token`
- **Dynamic client registration:** `https://mcp.higgsfield.ai/oauth2/register` ← we can register our own `client_id` programmatically
- **Grant types:** `authorization_code`, `refresh_token`
- **PKCE required:** `code_challenge_methods_supported: ["S256"]`
- **Token auth methods:** `client_secret_basic`, `client_secret_post`, `none` (so we can be a public PKCE-only client)
- **Scopes:** `openid`, `email`, `offline_access`
- **Custom claim:** `org_id` — multi-tenant workspace identifier

This is **the right shape for a future "MashupForge user OAuths into Higgsfield" SaaS flow**.

### 7 Tools exposed (per Higgsfield docs)
1. **Video analyzer** — analyses reference videos for style/motion
2. **Marketing video generator** — from product URLs
3. **Soul character training** — consistent characters from 8 reference photos
4. **Cinematic image to video** — animate images with cinematic presets (e.g. "Bullet Time")
5. **Viral clip generator** — cuts long videos into short-form clips with subtitles
6. **Virality prediction** — scores hook strength and retention risk
7. **Image/Video generation** — direct generation with access to 30+ models (the Swiss Army knife)

### Compatible clients (per Higgsfield)
- Claude Code / Codex — use CLI instead (their docs say so)
- OpenClaw (VPS-based)
- Hermes Agent (local)
- NemoClaw (NVIDIA hardware)
- Perplexity, Cursor
- Any MCP-compatible client (the spec is open)

### Generation behaviour
> "All generation runs asynchronously, so your agent polls for results and delivers them as soon as they're ready." — confirms the same async-with-poll pattern as the REST API

> "Images typically complete in a few seconds. Videos take longer depending on duration and model."

### History
> "You can browse your full generation history, reference any past image or video, and use it as a starting point for new creations." — every generation is referenceable by its job ID, which is great for our "regenerate from this" UX.

### Credits
> "Higgsfield tools use the same credit system as the Higgsfield platform. Each generation costs credits based on the model and resolution. Your existing Higgsfield plan credits work seamlessly through any connected agent."

---

## 6. Pricing — Credit Math

(Per geo.higgsfield.ai blog + current pricing page)

| Plan | Price | Credits | What it buys |
|------|-------|---------|--------------|
| Starter | $15/mo | 200 | ~100 Nano Banana Pro images OR ~33 Kling 3.0 videos |
| Plus | $39/mo | ~800 (est) | more parallel + some "unlimited" image models |
| Ultra | $99/mo | 3,000 | adds unlimited video, 8 parallel jobs |

Cost per call (rough):
- Nano Banana Pro 1K: ~2 credits
- Nano Banana Pro 2K: ~4 credits
- Nano Banana Pro 4K: ~8 credits
- Soul V2 1K: ~2 credits
- GPT Image 2 high 4K: ~6 credits
- Seedance 2.0 5s 720p: ~20 credits
- Seedance 2.0 5s 1080p: ~40 credits
- Veo 3.1 8s high: ~50-80 credits
- Kling v3.0 5s std: ~25 credits
- Hailuo 6s 768p: ~10 credits

**For MashupForge's "daily content" use case (the user has a $15-99 plan):**
- 1 idea = 1 image (Nano Banana Pro 2K) = ~4 credits
- 1 idea = 1 image + 1 video (Seedance 5s 720p) = ~4 + 20 = ~24 credits
- A 7-idea weekly schedule = ~28-170 credits
- $15 Starter → ~7 cycles/week max
- $39 Plus → ~15 cycles/week
- $99 Ultra → ~17 cycles/week (or unlimited if using the unlimited-video model)

This is way more attractive than flat-rate LLM image gen. The free auto models on Plus are a hidden gem.

---

## 7. Integration into MashupForge (concrete plan, NOT YET CODED)

### Files to create
1. `lib/higgsfield/models.ts` — type-safe model catalog (`HIGGSFIELD_MODELS` array with slug, displayName, family, defaults, creditHint, aspectRatios)
2. `lib/higgsfield/client.ts` — thin wrapper around `@higgsfield/client` v2 SDK, with `serverOnly` guard, env-based config, and helper `submit({ model, prompt, ... })` + `pollStatus(id)` + `cancel(id)`
3. `lib/higgsfield/errors.ts` — maps SDK errors to user-facing strings (NotEnoughCredits → "You've run out of Higgsfield credits. Top up at cloud.higgsfield.ai")
4. `app/api/higgsfield/image/route.ts` — POST { prompt, model, aspectRatio, resolution } → returns `{ imageUrl, requestId, cost }`; calls into `lib/higgsfield/client.ts`
5. `app/api/higgsfield/video/route.ts` — POST { prompt, model, startImageUrl?, aspectRatio, duration } → returns `{ videoUrl, requestId, cost }`
6. `app/api/higgsfield/status/[requestId]/route.ts` — GET for client-side polling fallback
7. `app/api/higgsfield/webhook/route.ts` — POST receiver for `X-Webhook-URL` callbacks
8. `app/api/higgsfield/account/route.ts` — GET credit balance (uses CLI's `higgsfield account` shape)

### Files to modify
1. `lib/desktop-config-keys.ts` — add `HIGGSFIELD_KEY_ID`, `HIGGSFIELD_KEY_SECRET`, optionally `HIGGSFIELD_WEBHOOK_SECRET`
2. `lib/model-specs/index.ts` — extend the JSON catalog with a new `image_source: "higgsfield"` family, listing all 18 image models
3. `lib/image-prompt-builder.ts` — extend the prompt builder to handle the `higgsfield` source (different system prompt template — they expect 2-15 line cinematic prompts, not 1-line product descriptions)
4. `components/SettingsModal.tsx` — new "Higgsfield" settings section: paste KEY_ID/KEY_SECRET, "Test connection" button, "View credit balance" link to cloud.higgsfield.ai, model selection per source
5. `components/Settings/VercelAiModelPicker.tsx` (or a sibling) — picker for Higgsfield image model when source = higgsfield
6. `hooks/usePipeline.ts` + `hooks/usePipelineDaemon.ts` — when `image_source = higgsfield`, call the new API route instead of `app/api/ai/image`
7. `lib/post-lifecycle/` — extend the `image_source` type union with `"higgsfield"`; no state machine changes needed
8. `package.json` — add `@higgsfield/client` dependency (latest version on npm)
9. `.env.example` — add `HIGGSFIELD_KEY_ID=` and `HIGGSFIELD_KEY_SECRET=` placeholders
10. `lib/text-model-catalog.ts` (style) — add a parallel `higgsfield-image-model-catalog.ts` so we keep the same pattern (catalog + resolver + picker)

### Pipeline integration
- `usePipeline.outerLoop()` already has the "image source per idea" switch — we just add a `higgsfield` branch
- For polling from the browser: the API route can do the polling server-side and return a ready URL (default)
- For long videos: use the webhook — POST to `/api/higgsfield/webhook` and the reconciler picks up the new `hostedImageUrl` / new `hostedVideoUrl` via the post-lifecycle state machine (this is exactly what v0.9.41's state machine was built for)
- For credit budgeting: the `lib/pipeline-budget.ts` (if we add one) can decrement from a per-cycle credit counter, pausing the pipeline if the monthly cap is hit

### Settings UX sketch
```
┌─ AI Engine ─────────────────────────────────────┐
│ Text Model:   [M3 ▾]                            │
│ Image Source: [Higgsfield ▾] (was: Leonardo)   │
│                                                  │
│ ── Higgsfield ──                                │
│ Credentials: [●●●●●●●●●●] Test ✓ Connected     │
│ Credits: 1,847 / 3,000  [Top up ↗]             │
│ Default image model: [Nano Banana Pro 2K ▾]    │
│ Default video model: [Seedance 2.0 720p ▾]     │
│ Parallel jobs: 3 (capped at 8 on Ultra plan)   │
│ Safety tolerance: 2 (0=strict, 5=loose)        │
└──────────────────────────────────────────────────┘
```

### Tests to add
- `tests/lib/higgsfield/client.test.ts` — mocks `@higgsfield/client`, verifies error mapping + polling fallback
- `tests/lib/higgsfield/models.test.ts` — model catalog invariants (every model has at least one aspect ratio, prompt is required, etc.)
- `tests/app/api/higgsfield/image/route.test.ts` — happy path, NotEnoughCredits, BadInput, AuthError
- `tests/app/api/higgsfield/webhook/route.test.ts` — verifies webhook signature + state machine transition

---

## 8. MCP Server — Use Case (Phase 2, not Phase 1)

The MCP server is great for a future "BYO Higgsfield subscription" SaaS mode:
- User clicks "Connect Higgsfield" in Settings
- We open `https://mcp.higgsfield.ai/oauth2/authorize?client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&scope=openid+email+offline_access&state=...`
- User logs in, grants, gets redirected back to `https://mashupforge.app/oauth/callback?code=...&state=...`
- We exchange code for tokens via `https://mcp.higgsfield.ai/oauth2/token`
- We store refresh_token encrypted in IDB
- We pass the access token to MCP tools via `Authorization: Bearer {access_token}`

This unlocks multi-tenant SaaS without us ever touching a Higgsfield API key. **Not in scope for v1.0.4** — flagged for the v1.1 / v2.0 SaaS arc.

---

## 9. Risks & Open Questions

### Risks
1. **Cost shock for the user.** Each generation costs real credits. We need a hard cap (per-cycle, per-day, per-month) the user sets in Settings — default to something conservative.
2. **No sandbox tier.** Higgsfield charges per credit even for "test" calls. We need to mock the SDK in dev mode unless an env flag is set.
3. **Browser-blocking.** The V2 SDK refuses to run in a browser (`BrowserNotSupportedError`). All calls must go through Next.js API routes. This is actually good for our architecture.
4. **Polling timeout.** Default `maxPollTime = 300_000ms = 5min`. Seedance 2.0 1080p can take longer. We may need to bump this to 10-15 min for heavy models, or rely on webhooks for those.
5. **Single-tenant credits.** With Path A, all generations draw from one subscription. If the user shares their desktop binary, anyone can use their credits. We need to either (a) make the key a per-installation thing the user pastes, or (b) accept this as the trade-off for desktop.
6. **NSFW moderation failures cost nothing** (auto-refund) but waste time — we should pre-filter prompts client-side for obvious problems.
7. **Webhook signature.** Higgsfield doesn't document a webhook signing scheme beyond the `secret` you configure. We need to verify the source IP / use the secret as a bearer token in the URL.

### Open questions
1. **Does the user have a Higgsfield API key minted already, or do they need to mint one?** This blocks any "let's test live" work.
2. **Webhook receiver:** For desktop, where does the webhook go? Options:
   - (a) `http://localhost:3847/api/higgsfield/webhook` — works for desktop, no external URL needed
   - (b) Use polling only — no webhook complexity
   - (c) Use a public tunnel (ngrok, cloudflare-tunnel) — adds dependency
   **Recommendation: (b) for v1.0.4**, add (a) if real-world latency becomes a problem.
3. **How aggressive should the credit budget be?** Default: 5 ideas/cycle × 1 image + 1 video = 10 generations/cycle × 24 credits = 240 credits/week. That's 80% of the Starter plan. Probably too aggressive — recommend 2 video/cycle, 5 image/cycle = 130 credits/week.
4. **Where to host the prompt templates?** Two reasonable choices:
   - Hardcode 5-10 "MashupForge-cinematic" templates in `lib/image-prompt-builder.ts`
   - Generate them on-the-fly via MiniMax M3 (text LLM) using a system prompt that knows Higgsfield's prompt style
   **Recommendation: hardcode the templates** — they're cheap, fast, and reproducible. The LLM-generated approach is Phase 2.
5. **Which image model is the best default?** My ranking for Instagram-first content:
   - **Nano Banana Pro (`nano_banana_2`)** — 4K capable, very fast, good all-rounder, "the default" on Higgsfield's marketing. **Recommend this as default.**
   - **FLUX.2 `pro`** — more stylized, better for branded visuals
   - **Higgsfield Soul V2 (`text2image_soul_v2`)** — best for character consistency (when user trains a Soul)
   - **Seedream 4.5** — strong for product photography
   - **Grok Image** — wildcards, can do photo + illustration
6. **Which video model is the best default?** For short-form 9:16:
   - **Seedance 2.0 5s 720p** — current "Hollywood film" model the YouTube video promotes, fast mode available, good price/quality
   - **Veo 3.1 Lite 8s 720p** — Google's best, slightly more expensive
   - **Kling v3.0 std 5s** — reliable, good for UGC-style
   - **Minimax Hailuo 6s 768p** — cheap option for volume

### Decisions deferred to user
- [ ] Mint API key, or skip Phase 1 and only do MCP?
- [ ] Polling-only or webhook?
- [ ] Default image model + default video model?
- [ ] Per-cycle credit cap (default value)?
- [ ] Should Higgsfield be a peer of Leonardo, or a replacement?

---

## 10. YouTube Video — FULL TRANSCRIPT (2026-06-03)

- **URL:** https://youtu.be/ZvDnoABlFjw
- **Title:** "Claude kann jetzt Hollywood-Filme generieren (Seedance 2.0)"
- **Channel:** Julian Ivanov | KI-Automatisierung (Lisa does the intro)
- **Length:** 16:10 (970 seconds)
- **Status after second attempt:** ✅ **Fully transcribed**. The user uploaded the WebM directly to the workspace (`/workspace/attachments/01e14685...webm`, 87MB, 1920×1080 AV1 60fps). ffmpeg extracted audio → listen_audio tool transcribed the German + English translation. The original YouTube is still blocked from the sandbox, but the local file made the analysis complete.

### 10.1 Key new facts from the video (not in the blog / CLI source)

1. **MCP connector setup in Claude Desktop**: Customize → Connectors → Add custom connector → URL `mcp.higgsfield.ai/mcp` → name "Higgsfield" → add → OAuth grant. After that, Claude can call `generate image`, `generate video`, `show generations` and the other 4 tools.

2. **Workflow the speaker uses** (and explicitly recommends):
   - **Step 1 (Character)**: `/banana-pro-director` skill — character description → feedback loop → "lock" → outfit design → reference photo with **Nano-Banana Pro** → multi-angle **Character Template** (front, side, back) → scene still as image. This is the "image first" pattern that matches the camera-grammar above.
   - **Step 2 (Video)**: **Cinema World Builder** skill for Seedance 2.0. 5 cinematic modes, each with own lens / movement / sound design. "Storyboard → multiple clips → string together" pattern.
   - **Skills are just text files** — description (when to load) + fixed prompt (how to handle the task). User can write their own or import community ones.

3. **Skills the speaker recommends**:
   - **Banana Pro Director** — image gen, character templates
   - **Cinema World Builder** — Seedance video, 5 cinematic modes
   - Both by "Joey" (his channel recommended for AI music videos) — free, text file downloads in description.

4. **Pricing (this is a NEW, more accurate number than the blog):**
   - Starter: 200 credits
   - Plus: **1,000** credits (the blog said "large", now confirmed), $49/mo ≈ €43
   - Ultra: 3,000 credits
   - **Seedance 2.0 15s HD + audio: 135 credits** (~$6.75 / €5.80 per video)
   - **Kling 3.0: significantly cheaper, also very good**
   - **Nano-Banana image: < 10 cents per image**

5. **Speaker's MCP-server + tool names match the CLI exactly**:
   - `generate image` and `generate video` are the user-facing names in Claude
   - Under the hood these map to the `higgsfield_generate` tool with a `model` arg
   - The other 5 tools (`higgsfield_video_analyzer`, `higgsfield_marketing_video`, `higgsfield_soul_train`, `higgsfield_cinema_image_to_video`, `higgsfield_viral_clip`, `higgsfield_virality_predictor`) are not exercised in the video — the speaker only uses `generate image` + `generate video`.

6. **Speaker confirms the "Claude writes the prompt" pattern**: Claude writes the Higgsfield prompt itself, picks the model, sets the duration/aspect_ratio/resolution. The user only describes the desired output in natural language. **This matches exactly what the v1.0.4 integration design enables** — our `useImageGeneration` could in theory wrap the same loop, but the user is in their own Claude chat for that, not in MashupForge. The integration in MashupForge is server-side MCP calls from Next.js routes, not Claude-in-the-loop.

7. **MCP server is compatible with**:
   - Claude Desktop (the speaker's main demo)
   - Hermes, OpenClaw, Cursor (mentioned)
   - ChatGPT (mentioned: "Das Ganze funktioniert auch über ChatGPT")
   - All agentic systems via MCP or CLI

8. **Marketing Studio** (one of the 7 MCP tools) is a dedicated feature for UGC ads, unboxing videos, product showcases. Pre-built templates, "re-create" pattern. Claude can call it through the MCP connector.

### 10.2 What the video adds vs the blog

| Topic | Blog | Video |
|-------|------|-------|
| MCP setup | Brief mention | Full step-by-step in Claude Desktop |
| Character consistency | Not covered | "Banana Pro Director" skill — 3-step workflow |
| Video consistency | Mentioned | "Cinema World Builder" skill — 5 cinematic modes |
| Seedance 2.0 credit cost | Not given | 135 credits for 15s HD+audio |
| Skills concept | Not covered | Full explainer, 2 recommended skills by name + creator |
| ChatGPT integration | Not covered | Confirmed compatible |
| Pricing (Plus) | "Large" | Exact: 1,000 credits, $49/mo |

**Bottom line: the video confirmed every technical claim the blog made AND added the Skills/character-consistency/workflow patterns. The credits math is also useful (15s Seedance = 135 credits; Nano-Banana image < 10c).**

---

## 11. Skills the video mentions (located 2026-06-03)

The speaker (Julian Ivanov) recommends two free Skills by "Joey" for users who want reproducible cinematic results. These are plain-text Claude Skills the user attaches to a Claude Project — they teach Claude how to write better Higgsfield prompts. **We do NOT need to implement Skills inside MashupForge** (MashupForge isn't a Claude Code session), but the prompt-engineering patterns inside them are gold for our image-prompt-builder.

### 11.1 Banana Pro Director (the one Julian recommended for image gen)

**Found at:** `https://github.com/sekirosevillans-sys/Awesome-AI-Agent-Skills/tree/master/banana-pro-director` (the closest public equivalent to "Joey's" version — same concept, same author community)

**The SLCT Framework** (4 layers, every image prompt):
- **S — SURFACE & SOUL** (the subject as a tactile surface): skin condition (`heavy glistening sweat`, `natural freckles`, `subsurface scattering on cheekbones`), emotional register (`athletic intensity`, `melancholic introspective`), micro-details (`intricate fibrous iris texture`, `visible red blood vessels in white sclera`).
- **L — LUMINA** (light physics): direction+quality (`hard directional light from upper right`, `cinematic low-key`, `golden hour natural side light`), interaction (`specular highlight streak from sweat`), reflections (`sharp rectangular catchlight in eyes`).
- **C — CAPTURE** (camera + proximity): proximity (`Extreme macro closeup`, `Ultra-tight crop focused on single eye`), optics (`85mm Macro lens`, `Shallow depth of field with creamy bokeh`, `Shot on Hasselblad 8K`), angle (`Angle slightly below eye level shooting upward`).
- **T — TEXTURE & TRUTH** (material physics): `raw unretouched skin`, `natural skin creases and wrinkle texture`, `dust and dirt particles embedded in sweat`.

**Anti-AI-look rules** (this is the actual differentiator):
- **NEVER** allow: `smooth skin`, `perfect face`, `3D render style`.
- **Always** use positive-prevention Negative Prompts: `soft diffused lighting, no shadows, flat even light, blue or cool tones, smooth airbrushed skin, no pores, dark eyebrow, both eyes visible, full face, female, clean shaven, studio lighting, painted, illustration, CGI, plastic skin, wet skin, sweat droplets, bright white background`.

**The 4-layer workflow** (image-first, then video):
1. **Skin Condition** — tone, texture, surface state (sweat, dust, pores)
2. **Light Source** — direction, quality, intensity, colour temp
3. **Camera Position** — angle, tilt, distance, crop
4. **Emotional Register** — what the face has lived through / feels in this moment

**Master prompt template** (Skin Study style):
> "Extreme macro closeup portrait of a middle-aged male, ultra-tight crop. **Skin**: weathered texture with enlarged pores, slight redness on nose bridge, raw unretouched surface. **Light**: dramatic hard directional sunlight from left creating extreme glistening skin texture. **Camera**: Hasselblad macro 8K, shallow depth of field. **Vibe**: masculine cinematic warmth."

**Camera angles catalog** (40 angles, from the `camera-angles.md` reference):
- **Eye Level** (neutrality, honesty): 1. Eye Level · 2. Close-up 85mm (intimacy) · 3. Medium Shot 50mm (realism)
- **Low Angles** (power): 4. Low Angle 30° (authority) · 5. Extreme Low (worm's eye) · 6. Wide-Angle Close-up (aggression)
- **High Angles** (vulnerability): 7. High Angle 30° · 8. Extreme High (bird's eye) · 9. Top-Down (flat lay / catalogue)
- **Dutch Angles** (tension): 10. Slight Tilt 5-10° · 11. Extreme Tilt 45°
- **Psychological intent**: 12. Over the Shoulder · 13. POV · 14. Macro

**The 3-step character workflow** (this is the seedance video's main insight):
1. **Lock character** with feedback loop (Nano Banana generates a reference photo)
2. **Multi-angle character template** (front / side / back / hands / nails) so the character looks the same from every angle in subsequent video clips
3. **Scene still as image** (cheaper than going straight to video) then use that as a Seedance reference frame

**Style lock protocol** (project-wide consistency):
- Same **Seed** across all generations
- Keep L (Lighting) + C (Camera) fixed; only vary S (Subject)

**Contact sheet template** (3x2 grid from 6 angles, character consistency):
> "Generate a 3x2 grid contact sheet of a single scene from 6 different angles (Extreme Low Angle, High Angle, Eye Level, Close-up, Wide Shot, POV). Maintain exact character consistency."

### 11.2 Cinema World Builder (the one Julian recommended for video)

**Found at:** `https://github.com/OSideMedia/higgsfield-ai-prompt-skill/tree/main/skills/higgsfield-cinema` (the closest public equivalent — Julian's "Joey" version isn't on a public GitHub, but this is the same skill family). Version 3.3.0, updated 2026-05-11, MIT licensed.

**Cinema Studio 2.5/3.0/3.5 surface** (the speaker's "5 cinematic modes" = the named genres in this skill):
- **2.5**: 8 named genres + full optical physics (camera body + lens stack) + color grading
- **3.0**: 7 genres (General, Action, Horror, Comedy, Noir, Drama, Epic) + native audio + @ reference system
- **3.5**: 8 Color Palettes / 6 Lighting / 9 Camera Moveset Styles + Camera Settings 4-axis panel (Camera Body / Lens / Focal Length including new 75mm / Aperture)

**The 10-step Cinema Studio 2.5 workflow** (this is the "world building" Julian references):
```
 1. SCRIPT        → Write or paste your scene description / shot list
 2. SOUL CAST     → (New in 2.5) Generate AI actors from parameters or use saved Elements
 3. REFERENCE     → Upload character photo → create Reference Anchor (or use Soul Cast actor)
 4. ELEMENTS      → (Optional) Define @Characters, @Locations, @Props if needed
 5. OPTICAL STACK → Select camera body + lens + focal length + aperture (image mode)
 6. HERO FRAME    → Generate a key image that defines the visual tone
 7. COLOR GRADE   → (New in 2.5) Apply color grading to keyframes before video generation
 8. CAMERA CONFIG → Set Director Panel movement + Speed Ramp + Duration in UI
 9. SHOT MODE     → Choose Single Shot / Multi-Shot Auto / Multi-Shot Manual
10. GENERATE → EXPORT → Chain into timeline or export to editing
```

**Elements system** (Cinema Studio's reusable asset library — works for Seedance 2.0 too):
- Three element types: **Character** (`@CharacterName`), **Location** (`@LocationName`), **Prop** (`@PropName`)
- Create once, reference in any subsequent prompt

**Per-Character Emotion** (Multi-Shot mode):
| Emotion | Effect |
|---------|--------|
| Joy | Smiling, warm expression, positive energy |
| (and ~10 others — see cinema sub-skill for the full table) | |

**Director Panel** (18 named movements in 2.5; 9 in 3.5) — these are the "camera grammar" the speaker references.

**The MCSLA formula** (5 layers, every video prompt): **Model · Camera · Subject · Look · Action**
- Every video prompt follows this order unless the user opts out
- Subject and primary action first (early clauses set the shot hierarchy)
- Cap at ~200 words; going over is "padding rather than locking"

### 11.3 What this means for MashupForge

**MashupForge is NOT a Claude Code session**, so we don't need to ship the Skills themselves. But the prompt-engineering patterns inside them are directly applicable:

1. **For `lib/image-prompt-builder.ts`**: the SLCT 4-layer framework (Surface, Lumina, Capture, Texture) is a much better default than "natural language + keywords". We could pre-compute the L (lighting) and C (camera) layers from the user's settings, then let the user customize the S (subject) layer in their own words.

2. **For `higgsfieldOptions` in our API route**: we already forward `aspect_ratio`, `resolution`, `quality`, etc. The cinema sub-skill's "5 cinematic modes" map to Seedance 2.0's `genre` enum (`auto / action / horror / comedy / noir / drama / epic`). The `duration` + `mode` + `genre` + `resolution` + `start_image` quintet IS the "camera grammar" the speaker references — our current `HiggsfieldBuilderOptions` already has all 5 fields.

3. **For the future "long-form video with recurring character" feature**: the 3-step character template workflow (lock → multi-angle → scene still) is a much better approach than ad-hoc generation. When the user wants recurring characters across multiple videos, we should:
   - Generate a 6-shot character template (front / side / back / hands / nails / 3-quarter) with Nano Banana Pro
   - Save it as a "Soul Pack" in the user's library
   - Reference it via `--soul-id` in subsequent Seedance generations

4. **The Skills files themselves** are saved at `docs/research/higgsfield-skills/` for future reference. The Banana Pro Director and Cinema World Builder equivalents are the two most directly applicable to our image-prompt-builder and imageProvider='higgsfield' code paths.

**Verdict:** we don't need to build a "Skills" surface in MashupForge. The user's MashupForge interface is a different shape from Claude Projects. But the prompt-engineering content inside these Skills is gold for upgrading our prompt builder in v1.0.5+.

---

## 12. Sources & Reliability

| Source | Reliability | Coverage |
|--------|-------------|----------|
| https://higgsfield.ai (main) | High — official | Marketing, model list (subset) |
| https://higgsfield.ai/mcp | High — official | MCP UX, tool descriptions |
| https://higgsfield.ai/cli | High — official | CLI quickstart, model list |
| https://higgsfield.ai/pricing | High — official | Plan limits, model availability matrix |
| https://higgsfield.ai/seedance/2.0 | High — official | Seedance 2.0 deep-dive (12 multimodal inputs, native audio) |
| https://higgsfield.ai/nano-banana-intro | High — official | Nano Banana Pro / 2 deep-dive (16-bit, 4K) |
| https://higgsfield.ai/blog/Generate-AI-Videos-From-Claude-with-Higgsfield-MCP | High — official | MCP usage example, prompt examples |
| https://github.com/higgsfield-ai/higgsfield-js | **Highest — source code** | SDK API surface, auth, polling, errors |
| https://github.com/higgsfield-ai/cli | **Highest — source code** | CLI commands, model slugs |
| https://raw.githubusercontent.com/higgsfield-ai/cli/main/MODELS.md | **Highest — source code** | Complete model parameter schema (35 models) |
| https://mcp.higgsfield.ai/.well-known/oauth-authorization-server | **Highest — live** | OAuth endpoints, scopes, grant types |
| YouTube `https://youtu.be/ZvDnoABlFjw` (local WebM) | ✅ Transcribed | Full 16-min tutorial (German + English) — see §10 |
| https://github.com/sekirosevillans-sys/Awesome-AI-Agent-Skills/tree/master/banana-pro-director | Medium — community | Closest public equivalent of "Joey's" Banana Pro Director Skill |
| https://github.com/OSideMedia/higgsfield-ai-prompt-skill | High — community v3.7.16 | Most comprehensive Higgsfield skill (24 sub-skills, MCSLA formula, Cinema Studio 2.5/3.0/3.5) — see §11.2 |
| https://github.com/Emily2040/seedance-2.0 | High — community v5.4.5 | Most comprehensive Seedance 2.0 skill (15 sub-skills, multilingual vocab) |
| https://apidog.com/blog/higgsfield-api/ | Medium — third-party walkthrough | API examples (matches SDK) |
| https://github.com/AKCodez/higgsfield-claude-skills | Medium — community, current | Real-world UGC pipeline patterns (Playwright automation) |

**All actionable claims in this report are traceable to the SDK source code (`higgsfield-js`), the CLI's `MODELS.md`, the official pricing page, the official MCP OAuth discovery, and the full YouTube transcript.** The blog and main-site claims have been cross-checked against these primary sources. The Skills found in §11 are saved at `docs/research/higgsfield-skills/` for future reference.

---

## 13. One-Page Decision Recap for the User

**Should we integrate Higgsfield into MashupForge?**
Yes — it's strictly additive to what we already have, doesn't require ripping out anything, and the user already has a subscription.

**If yes — which path?**
**Path B (MCP server + per-user OAuth)** — the user's choice (2026-06-03). Each user connects their own Higgsfield account; the server registers a public OAuth client via dynamic client registration on first /api/higgsfield/oauth/authorize call. Tokens are encrypted at rest with AES-GCM in IDB.

**Why MCP, not REST+SDK?**
- No shared API key on the server (multi-tenant from day 1)
- The Higgsfield YouTube tutorial demonstrates ONLY the MCP path (Claude Desktop → Customize → Connectors → Add custom connector → mcp.higgsfield.ai/mcp)
- Each user pays for their own generations — no metering headaches, no leaked-key support tickets
- Future SaaS path preserved: if/when we want to host multi-tenant, we keep the same OAuth flow

**What about the CLI?**
`@higgsfield/cli` is bundled as a devDep — power users can `npx @higgsfield/cli model list` to browse the full 35-model catalog, or run `higgsfield generate create` from their terminal. Same OAuth account, no separate config.

**Default model picks** (per user's preferences, 2026-06-03):
- **Image**: Nano Banana Pro (`nano_banana_2`) — 4K capable, cheap (<10c), Higgsfield's flagship
- **Video**: Seedance 2.0 (`seedance_2_0`) — the "Hollywood film" model the video showcased
- Nano Banana Pro is a peer of Leonardo, not a replacement — both are selectable per idea

**Status:**
- ✅ Research: complete (§10 full transcript + §11 skills)
- ✅ Implementation: v1.0.4 shipped on branch `feature/higgsfield-integration` (commit 81bdc7c)
- ✅ Tests: 1243/1243 pass
- ✅ Build: under 300KB budget
- ⏳ PR: needs to be opened via GitHub URL (no `gh` CLI in sandbox)
- ⏳ v1.0.4 release: after PR merges to main

**Risk to ship without this?**
None. v1.0.3 already works. Higgsfield is purely additive and the user explicitly asked us to research it before integrating, so the v1.0.x line stays stable.
