# Story: nca Install Flow — Dev

**Story ID:** NCA-INSTALL-DEV
**Brief:** `docs/bmad/briefs/nca-install-flow.md`
**Assignee:** Dev
**Status:** Open

## Context

nca is not installed on the user's machine. The Settings UI needs to guide the user through install → auth → model selection. Dev owns the API endpoint that returns model list; Designer owns the Settings UI state machine.

## Technical Notes

### 1. New route: `GET /api/nca/models`

File: `app/api/nca/models/route.ts`

```typescript
import { spawn as nodeSpawn } from 'node:child_process';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return new Promise((resolve) => {
    const child = nodeSpawn('nca', ['models', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on('data', () => { /* discard logs */ });
    child.on('error', () => resolve(NextResponse.json({ error: 'nca not found' }, { status: 503 })));
    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve(NextResponse.json({ error: 'nca models failed' }, { status: 500 }));
        return;
      }
      try {
        resolve(NextResponse.json(JSON.parse(stdout.trim())));
      } catch {
        resolve(NextResponse.json({ error: 'invalid JSON from nca models' }, { status: 500 }));
      }
    });
  });
}
```

### 2. Setup route already handles model save

`app/api/nca/setup/route.ts` already accepts `{ apiKey, model }` in the POST body and persists `NCA_MODEL` to config.json. No changes needed there.

### 3. Files to Create

- `app/api/nca/models/route.ts` — GET only, streams `nca models --json` to JSON response

## Acceptance Criteria

- [ ] `GET /api/nca/models` returns valid JSON from `nca models --json`
- [ ] Returns 503 when nca binary is not found
- [ ] Returns 500 when nca exits non-zero
- [ ] No changes to setup route needed (already handles model save)
- [ ] tsc clean, vitest passes
