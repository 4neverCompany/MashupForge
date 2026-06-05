# Issue 3 — Instagram Scheduled Posts Fail: Wrong Token Type on Vercel

**Date:** 2026-04-30
**Triage owner:** Developer
**Severity:** P0 — Instagram automation cannot publish anything

## TL;DR

`INSTAGRAM_ACCESS_TOKEN` on Vercel production starts with **`IGAA`** —
that is an **Instagram Basic Display API** token. The Instagram Content
Publishing API does not accept it; it requires a **Facebook Page Access
Token** (starts with `EAA*`) issued for a Page connected to an Instagram
Business / Creator account.

Replace the env var with a Page Access Token. No code change needed.

## Trace: manual vs scheduled

### Shared call site

Both flows POST to `/api/social/post`. The route resolves IG creds once
via `lib/instagram-credentials.ts`:

```ts
return {
  igAccountId:    env.INSTAGRAM_ACCOUNT_ID  ?? body?.igAccountId  ?? '',
  igAccessToken:  env.INSTAGRAM_ACCESS_TOKEN ?? body?.accessToken ?? '',
};
```

`??` only falls through on `null`/`undefined`. Once an env value is a
non-empty string, **env always wins** — body is never consulted.

### Manual flow (browser → /api/social/post)

`components/MainContent.tsx`:

```
fetch('/api/social/post', { body: JSON.stringify({
  caption, platforms, mediaUrl, mediaBase64,
  credentials: buildCredentialsPayload(),  // includes browser-stored IG creds
}) })
```

`buildCredentialsPayload()` reads from `settings.apiKeys.instagram`
(localStorage) and ships `{ accessToken, igAccountId }` in the request.

### Scheduled flow (cron → /api/social/post)

`app/api/social/cron-fire/route.ts` calls:

```
fetch(`${baseUrl}/api/social/post`, { body: JSON.stringify({
  caption, platforms, mediaUrl/mediaUrls,
  credentials: {},                         // ← empty
}) })
```

The server-side queue (`/api/queue/schedule` → Upstash Redis) does **not**
persist credentials with each post. There is no place for the cron forwarder
to source them from, so it sends `{}`.

### Where they diverge

| | Manual | Scheduled |
|---|---|---|
| `body.credentials.instagram` | browser-stored creds | `undefined` |
| `?? body?.X` fallback live? | yes, if env is `undefined` | no — body has nothing |
| If env is set but wrong | env wins → fails identically to scheduled | env wins → fails |
| If env is unset | falls through to browser creds | fails: "Instagram credentials incomplete" |

The architectural divergence is single-pointed: scheduled posts cannot
fall through to per-user browser credentials. They live or die by
`process.env.INSTAGRAM_*` on the Vercel server.

## Evidence

### The wrong token is on Vercel

```
$ vercel env run -e production -- bash -c 'echo "${INSTAGRAM_ACCESS_TOKEN:0:4} len=${#INSTAGRAM_ACCESS_TOKEN}"'
IGAA len=184
```

Token starts with `IGAA` → Instagram Basic Display API. The publish
route in `app/api/social/post/route.ts` line 221 explicitly rejects it:

```ts
if (igAccessToken.startsWith('IGAA')) {
  throw new Error('You are using an Instagram Basic Display token (starts with IGAA). ' +
    'To publish posts, you need a Facebook Page Access Token (starts with EAA). ' +
    'Get one from Meta Developer Portal -> Graph API Explorer.');
}
```

### A scheduled post already failed with this exact error

`mashup:queue:results` HASH on Upstash, key `ig-token-test3`:

```json
{
  "id": "ig-token-test3",
  "status": "failed",
  "at": 1777538941095,
  "error": "HTTP 500: You are using an Instagram Basic Display token (starts with IGAA). To publish posts, you need a Facebook Page Access Token (starts with EAA). ..."
}
```

`at = 2026-04-30T08:09:01Z` — about 1h before cron-fire started returning
401, so this failure was *before* Issue 2's secret rotation problem. The
IG-token problem is independent and pre-existing.

The error did reach the queue's results — it is **not** silent server-side.
The user-perceived "silent" failure is a UX gap: there is no client-side
surface that fetches `mashup:queue:results` and displays the failure
reason next to the scheduled post in the calendar. Cron-fire only logs to
the GH Actions workflow output.

### `INSTAGRAM_ACCOUNT_ID` is set (also confirmed)

The publish check ordering in `/api/social/post`:

```ts
if (!igAccessTokenRaw || !igAccountIdRaw) throw new Error('Instagram credentials incomplete');
// ↑ this runs BEFORE the IGAA check
if (igAccessToken.startsWith('IGAA')) throw new Error('IGAA error...');
```

Because the test post hit the IGAA branch (not the "incomplete" branch),
both env vars must have been non-empty when it ran. So
`INSTAGRAM_ACCOUNT_ID` is genuinely set on Vercel — it just can't be
read via CLI because it is `type=sensitive`.

## What "manual works" probably meant

If the user posts manually from the **deployed web app**, env wins via
`??`, so manual would also fail with the same IGAA error. The user's
report of manual success likely refers to either:

- the **desktop (Tauri)** build, where env comes from local `config.json`
  (which presumably has the correct EAA token), bypassing Vercel entirely; or
- a manual post made **before** the IGAA token was added to Vercel
  (`INSTAGRAM_ACCESS_TOKEN` was added 6h ago per `vercel env ls`).

Either way, the fix is the same.

## Fix (recommended — NOT executed autonomously)

1. Generate a **Facebook Page Access Token** with `instagram_basic`,
   `instagram_content_publish`, and `pages_read_engagement` scopes via
   Meta Developer Portal → Graph API Explorer. The Page must be the one
   linked to the IG Business/Creator account whose ID is in
   `INSTAGRAM_ACCOUNT_ID`.
2. Replace the value on Vercel:
   ```
   vercel env rm INSTAGRAM_ACCESS_TOKEN production -y
   vercel env rm INSTAGRAM_ACCESS_TOKEN preview -y
   echo -n "EAA…" | vercel env add INSTAGRAM_ACCESS_TOKEN production -y --sensitive
   echo -n "EAA…" | vercel env add INSTAGRAM_ACCESS_TOKEN preview -y --sensitive
   ```
3. Trigger a Vercel redeploy (env changes don't auto-redeploy):
   ```
   vercel redeploy <latest-prod-url> --target production --scope team_bzkLZ1hImGphs8qIr4ywhcVH
   ```
4. Smoke-test by enqueueing a test post (any image + IG platform with a
   `fireAt` in the past) and triggering the workflow:
   ```
   gh workflow run cron-fire-scheduled-posts.yml -R 4neverCompany/MashupForge
   ```
   Watch for `claimed >= 1` and `posted: 1` in the cron-fire JSON summary.

## Adjacent issue (out of scope, log it)

Scheduled-post failures are not surfaced in the UI. `mashup:queue:results`
is written but no React effect polls it back. Consider wiring a fetch to
`/api/queue/results` (already exists per `app/api/queue/results/route.ts`)
into the calendar view so users see "failed: token mismatch" on a post
instead of silent stalling.
