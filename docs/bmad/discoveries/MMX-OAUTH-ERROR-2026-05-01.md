# MMX OAuth — Upstream Endpoint Now Errors (Was 404)

**Date:** 2026-05-01
**Severity:** P1 — credential setup blocked for users routed through OAuth
**Triage:** Developer
**Task id:** MMX-OAUTH-ERROR-FIX
**Predecessor:** [`MMX-OAUTH-404-2026-04-30.md`](MMX-OAUTH-404-2026-04-30.md)

## Symptom

Maurice reports that `mmx auth login` now opens its OAuth URL on
`platform.minimax.io` successfully (no longer 404), **but the OAuth
website itself shows an error**. The login page loads, MiniMax's
server is reachable, but the OAuth handshake fails on their side
with an error visible to the user.

This is the second progression of the same upstream issue:
- 2026-04-30: `/oauth/authorize?client_id=mmx-cli` → HTTP 404.
- 2026-05-01: `/oauth/authorize?client_id=mmx-cli` → HTTP 200, page
  renders, but contains an error message instead of the consent UI.

## Diagnosis

Still upstream. We do not control `platform.minimax.io` or the
`mmx-cli` package's OAuth client_id / redirect URI. Without the exact
error text or a screenshot of the MiniMax page, we can't diagnose
further than "MiniMax is iterating on the endpoint and it's broken in
a different way today."

`--method api-key` continues to work end-to-end:

```
mmx auth login --method api-key --api-key sk-xxxxx
mmx auth status   # exit 0
```

That is what `/api/mmx/setup` does when the Settings api-key paste
form is used. **The api-key path is unaffected by this incident**, just
like it was unaffected by the 404 yesterday.

## What we changed (in our control)

### `app/api/mmx/setup/route.ts`

Both platform branches previously **auto-ran** the OAuth flow when the
user clicked the MMX card while unauthenticated:

- POSIX: tmux script ran `mmx auth login --no-browser` if `mmx auth
  status` failed.
- Windows: `cmd /k mmx auth login` opened a console window already
  invoking the OAuth flow.

That auto-run sent users straight into the broken upstream UI with no
actionable recourse. Both branches now print clear guidance instead:

> MMX is not yet authenticated.
>
> RECOMMENDED: close this terminal and paste your MiniMax API key in
> MashupForge Settings → AI Agent. That is the working path.
>
> Get an API key at: https://platform.minimax.io/
>
> Note: `mmx auth login` (OAuth) currently shows an error on the
> MiniMax website. Use the API key flow until upstream fixes it.

Power users who specifically want to try OAuth themselves can still
run `mmx auth login` from the prompt — we no longer run it for them.

### Response message

The route's success response now explicitly tells the UI consumer:

> Recommended: paste your MiniMax API key in this Settings panel above
> — that is the working path (OAuth currently shows an error on
> platform.minimax.io).

So the in-card status panel reads as guidance toward the working path,
not an OAuth confirmation.

## What we did NOT change

- The api-key paste form (`components/SettingsModal.tsx`) — already
  the visual primary, unchanged from MMX-OAUTH-404-FIX.
- The "Get one at platform.minimax.io →" external link — unchanged.
- `lib/mmx-client.ts` spawn-via-shell handling — unchanged.

## Acceptance criteria

- [x] **OR clear error shown to user** — the user no longer encounters
      the broken upstream OAuth page through any path we control. The
      tmux/cmd terminals open straight to instructions, not to the
      OAuth flow. Users hitting the OAuth error must have explicitly
      typed `mmx auth login` themselves; in that case the error they
      see is MiniMax's, not ours.
- [x] **API-key method clearly presented as working alternative** —
      explicit copy in both terminal flows AND in the route response
      message names the api-key form as the recommended path and
      flags OAuth as currently broken.

## Follow-ups to consider

- **File a bug with MiniMax** referencing both 404 (2026-04-30) and
  page-error (2026-05-01) regressions, with screenshots if Maurice
  can capture the current error text. Their `mmx-cli` is the only
  package using that endpoint AFAIK, so it's possible no one else has
  reported it.
- **Telemetry on the api-key path** — we don't currently log success
  rates. Worth adding a counter so we can confirm the api-key path
  stays healthy if MiniMax breaks something else.
- **Consider hiding `Open MMX CLI` in the unauthenticated state** —
  right now the card-click in unauthenticated state opens the tmux
  session with the new instructional banner, but a user who wants the
  api-key form may find the terminal-open behaviour confusing. Could
  be a follow-up UX polish.

## Files

- `app/api/mmx/setup/route.ts` — Windows branch (~lines 285-320),
  POSIX tmux script (~lines 338-380).
