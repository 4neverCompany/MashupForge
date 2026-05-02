# Story: nca Install Flow — Design

**Story ID:** NCA-INSTALL-DESIGN
**Brief:** `docs/bmad/briefs/nca-install-flow.md`
**Assignee:** Designer
**Status:** Open

## Context

nca is not installed on the user's machine. The Settings UI needs to guide the user through install → auth → model selection. Designer owns the state machine; Dev owns the API endpoint.

## Technical Notes

### Files to Modify

- `components/SettingsModal.tsx`

### State Machine (ncaSetupBlock)

The `ncaSetupBlock` in `SettingsModal.tsx` currently renders the same UI regardless of whether nca is "not installed" vs "not authenticated". This needs to branch on `ncaStatus`.

**Current structure (lines 340–400+):**
```typescript
const ncaSetupBlock = (
  <div className="space-y-3">
    <p className="text-[11px] text-zinc-400">{ncaCaption}</p>
    {/* API key form — shown always */}
    <div className="space-y-1">
      <label ...>MiniMax API key</label>
      <input ... />
      <button>Save</button>
    </div>
    <a href="https://platform.minimax.io/" ...>
  </div>
);
```

**Required changes:**

#### State 1: Not Installed (`ncaStatus == null || !ncaStatus.available`)

Show:
- Caption: "nca is not installed yet."
- **Install button** — opens `https://github.com/madebyaris/native-cli-ai/releases` in new tab
  - Primary CTA, gold style (`btn-gold-sm` or similar)
  - Label: "Install nca"
- Subtext: "Windows: `winget install Aris.native-cli-ai`" (muted, small)
- **HIDE** API key form (confusing at this stage)
- External link to platform.minimax.io removed (not relevant before install)

#### State 2: Not Authenticated (`ncaStatus.available === true && !ncaStatus.authenticated`)

Show:
- Caption: "nca is installed but not authenticated."
- API key form (existing, keep as-is)
- External link to platform.minimax.io

#### State 3: Authenticated (`ncaStatus.authenticated === true`)

Show:
- Status: "nca is authenticated and ready."
- **Model picker** — fetches from `GET /api/nca/models` on mount/refresh
  - Radio buttons or select dropdown for each model
  - Group by provider (MiniMax models together, OpenAI models together, etc.)
  - Current selection highlighted with gold border
  - On selection: `POST /api/nca/setup` with `{ model: "MiniMax-M2.7" }`
  - After save: re-probe status via `refreshNcaStatus()`
- **"Open nca CLI" button** — replaces "Open MMX CLI" label
  - Calls `handleNcaSetup()` (the probe/CLI launcher)
  - Label: "Open nca CLI to change provider/model"
  - Shown when authenticated

### Helper for model list

Add a local state for the model list:
```typescript
const [ncaModels, setNcaModels] = useState<NcaModel[] | null>(null);
```

Fetch on mount when authenticated:
```typescript
useEffect(() => {
  if (ncaStatus?.authenticated) {
    fetch('/api/nca/models')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.provider_models) setNcaModels(data.provider_models); })
      .catch(() => {});
  }
}, [ncaStatus?.authenticated]);
```

Model picker render: radio list grouped by provider.

### Files to Modify

- `components/SettingsModal.tsx` — state machine in `ncaSetupBlock`

## Acceptance Criteria

- [ ] Not Installed state shows Install button + winget hint, hides API key form
- [ ] Install button opens GitHub releases in external tab
- [ ] Not Authenticated state unchanged (API key form + platform link)
- [ ] Authenticated state shows model picker populated from `/api/nca/models`
- [ ] Model selection saves via existing `POST /api/nca/setup` with `{ model }`
- [ ] "Open nca CLI" button labeled correctly (not "MMX CLI")
- [ ] tsc clean, vitest passes
