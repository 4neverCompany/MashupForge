# IMPROVE-002 — Azure Trusted Signing for Windows SmartScreen

**Status:** research complete → recommendation: **adopt**, pending eligibility + legal-identity gate
**Classification:** complex (release-path change, recurring cost, identity-verification flow, CI secret surface)
**Date:** 2026-04-18

---

## Goal

Eliminate the SmartScreen "Windows protected your PC — unknown publisher"
warning on the MashupForge `.exe` installer produced by
`tauri-windows.yml`. Today we ship an installer signed only with the
Tauri updater's minisign key (`TAURI_SIGNING_PRIVATE_KEY`) — that key
proves *update authenticity* but is not an Authenticode certificate, so
Windows treats the binary as effectively unsigned. First-run users see
a blue modal and must click through "More info → Run anyway", which the
task framing correctly identifies as an adoption killer.

The standard fix is Authenticode signing with a CA-issued Code Signing
Certificate. The question is *which* path: legacy EV/OV cert from
Sectigo/DigiCert/GlobalSign, or Microsoft's newer Azure Trusted Signing
(formerly Trusted Signing, now rebranded to "Artifact Signing" as of
early 2026).

---

## TL;DR

**Adopt Azure Trusted Signing.** It costs ≈ $9.99/month, grants
instant SmartScreen reputation (no 3,000-install ramp), requires no
HSM/YubiKey hardware dance, and has a first-party GitHub Action that
plugs into our existing `windows-latest` workflow with one YAML step.
The blocker is *not* the tech — it's (a) confirming the signing
entity is eligible under Microsoft's regional rules and (b) completing
Microsoft Entra Verified ID identity verification, which is a
human-in-the-loop process that has taken other teams anywhere from
10 minutes to 30+ days (EU applicants skew slower).

---

## Current state

- `src-tauri/tauri.conf.json` line 33–47: bundle target is `nsis` only,
  no `windows.signCommand` configured.
- `.github/workflows/tauri-windows.yml` (per the existing windows
  release path referenced in IMPROVE-001) passes
  `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` —
  these are **minisign** secrets for the updater signature
  (`latest.json` → `.exe.sig`), not Authenticode.
- `docs/WINDOWS-BUILD.md` explicitly acknowledges Phase 3
  (code-signing) as deferred; SmartScreen warnings are accepted today.
- Pubkey hardcoded in `tauri.conf.json` line 54
  (`dW50cnVzdGVkIGNvbW1lbnQ6...`) is the minisign updater pubkey. This
  is orthogonal to Authenticode — it stays.

The minisign chain and the Authenticode chain are independent and
both survive: the updater keeps verifying `.exe.sig` with minisign,
and Windows starts trusting the `.exe` itself because it's now
Authenticode-signed.

---

## Option comparison

| Dimension | Self-signed (today) | Traditional OV cert (Sectigo/DigiCert) | Traditional EV cert + HSM | **Azure Trusted Signing** |
|---|---|---|---|---|
| SmartScreen on day 1 | ❌ Blocked | ❌ Still warns until ~3,000 clean installs earn reputation | ✅ Instant | ✅ Instant (reputation lives on Microsoft's validated identity, not per-cert) |
| Up-front cost | $0 | $150–$400/yr | $400–$900/yr | $0 |
| Recurring cost | $0 | $150–$400/yr | $400–$900/yr | $9.99/month (≈ $120/yr) on Basic tier |
| Hardware | none | none | **Physical YubiKey/HSM required**, must be plugged into signing machine or remote-signed via cloud HSM | none — cloud-managed keys |
| CI integration | trivial (no-op) | Copy `.pfx` into CI secret, `signtool` step | Painful — HSM token + PIN can't live in GH Actions; needs a dedicated self-hosted runner or cloud-HSM service | First-party `azure/artifact-signing-action@v1`, Entra ID OIDC or client-secret |
| Cert management | N/A | Manual renewal yearly, re-upload to CI | Manual renewal, re-provision HSM | Transparent — Microsoft rotates certs daily with 3-day lifespan; you never touch the cert |
| Eligibility gate | none | business OR individual | business OR individual | **Business in US/CA/EU/UK**, individuals only US/CA (as of 2026-04) |
| Wait to first sign | 0 min | hours | days | 10 min – 30+ days (identity verification, EU slower) |
| Compatible with IMPROVE-001 Linux cross-compile? | yes | yes | yes | **No — signtool is Windows-only** (same limitation either Authenticode path hits) |

The gap between OV and Trusted Signing is decisive: OV *still* triggers
SmartScreen on day 1 because SmartScreen reputation is earned per
certificate through downloads, not conferred by the cert's existence.
Azure Trusted Signing breaks that model by tying reputation to the
Microsoft-verified *identity* behind the cert, so the first signed
binary is trusted.

---

## Prerequisites for Azure Trusted Signing

### 1. Azure tenancy
- Microsoft Entra tenant (free; create one if 4neverCompany doesn't
  have one already).
- Azure subscription (pay-as-you-go; no baseline charge, just a
  billing vehicle).
- Register the `Microsoft.CodeSigning` resource provider on the
  subscription before creating the signing account.

### 2. Regional + entity eligibility — **blocks progress if failed**
| Signing as… | Allowed regions (2026-04) |
|---|---|
| Business / legal entity | US, Canada, EU, UK |
| Individual developer | US, Canada only |

> **Action for Hermes / Maurice:** Confirm where 4neverCompany is
> legally registered (if at all) and whether signing should be done
> under the company identity or Maurice's personal identity. If the
> company is EU-registered, go the business route; individual route
> is closed for EU applicants. This is the first unblocking decision.

### 3. Identity verification
- Business: DUNS number OR tax ID, plus a legally authorized
  representative who can sign the attestation. Verification via
  Microsoft Entra Verified ID.
- Individual: government-issued photo ID (passport / driver's
  license / national ID), plus a recent utility bill or bank
  statement if the ID doesn't show a residential address.
- Microsoft outsources the verification step to AU10TIX, which
  requires installing Microsoft Authenticator on a phone and
  submitting the ID through the app's Verified ID flow.

### 4. Signing-account + certificate-profile resources
Created once in the Azure Portal after verification passes:
- **Signing account** (holds the validated identity)
- **Certificate profile** (the cert lineage used by each signing op)

### 5. RBAC — the "403 trap"
Two distinct roles, and assigning them to the wrong principal is the
single most-reported setup failure:
- `Trusted Signing Identity Verifier` — needed by the *human* who
  submits the identity validation request.
- `Trusted Signing Certificate Profile Signer` — needed by the
  *CI principal* (app registration / managed identity) that the
  GitHub Action authenticates as.

Scope both at the signing-account level, not subscription-wide.

### 6. CI authentication
Two supported auth modes:
- **Client secret** (simplest): store `AZURE_CLIENT_ID`,
  `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` as GitHub secrets.
- **OIDC federated identity** (recommended long-term): GitHub Actions
  exchanges a signed OIDC token for an Entra access token —
  no stored client secret, better rotation story. Configure via
  federated credentials on the app registration tied to
  `repo:4neverCompany/MashupForge:ref:refs/heads/main` or tag
  patterns.

### 7. Tauri-specific runtime
- `.NET 8 runtime` on the signing machine (was .NET 6; the new MSI
  installer bundles this).
- `signtool.exe` ≥ `10.0.2261.755` (newer Windows 11 SDK). The version
  shipped with the default `windows-latest` GitHub runner image
  currently meets this; pinning the SDK version in the workflow is
  recommended to avoid drift.
- `trusted-signing-cli` (cargo crate) **or** the Microsoft
  `Microsoft.Trusted.Signing.Client` dlib that plugs into `signtool`.
  Tauri v2 docs recommend the former; the Azure GitHub Action uses
  the latter internally. Either works; `trusted-signing-cli` is
  simpler to wire into `tauri.conf.json`.

---

## Integration plan (design-only, not executed)

### Change 1 — `tauri.conf.json` (additive)

Add a `bundle.windows.signCommand` so `tauri build` signs the NSIS
installer and the embedded `.exe` in one pass:

```jsonc
{
  "bundle": {
    "targets": ["nsis"],
    "windows": {
      "signCommand": "trusted-signing-cli -e https://weu.codesigning.azure.net -a mashupforge-signing -c mashupforge-prod -d MashupForge %1"
    }
  }
}
```

Flags:
- `-e` endpoint — regional; use `weu` (West Europe) if we operate
  under an EU tenant, `wus2` / `eus` for US tenants. Must match the
  region the signing account was created in.
- `-a` account name — the signing-account resource created in step 4.
- `-c` certificate profile name — the profile under that account.
- `-d` description — shown in UAC prompts. Keep short, no version
  numbers (would churn the string every release).
- `%1` is the file path Tauri substitutes at sign time.

The minisign updater keys (`TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) stay untouched — they sign the
`.sig` sidecar that the auto-updater consumes, which is orthogonal to
Authenticode.

### Change 2 — `.github/workflows/tauri-windows.yml` (additive)

Before the `npx tauri build` step, install the CLI and export the
three Azure env vars from secrets:

```yaml
- name: Install trusted-signing-cli
  run: cargo install --locked trusted-signing-cli

- name: Tauri build (with Azure Trusted Signing)
  env:
    AZURE_TENANT_ID:     ${{ secrets.AZURE_TENANT_ID }}
    AZURE_CLIENT_ID:     ${{ secrets.AZURE_CLIENT_ID }}
    AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
    TAURI_SIGNING_PRIVATE_KEY:          ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  run: npx tauri build
```

`trusted-signing-cli` is invoked transparently by Tauri via
`signCommand`, so no separate sign step is needed.

**Alternative (no Rust crate install):** use the first-party
`azure/artifact-signing-action@v1` as a post-build step and drop
`signCommand` from `tauri.conf.json`. This adds a second bundle pass
but removes the `cargo install` latency (~1 min cold on CI):

```yaml
- name: Sign Windows bundle with Azure Trusted Signing
  uses: azure/artifact-signing-action@v1
  with:
    endpoint: https://weu.codesigning.azure.net
    signing-account-name: mashupforge-signing
    certificate-profile-name: mashupforge-prod
    files-folder: src-tauri/target/release/bundle/nsis
    files-folder-filter: exe
    file-digest: SHA256
    timestamp-rfc3161: http://timestamp.acs.microsoft.com
    timestamp-digest: SHA256
```

Recommendation: use the Tauri `signCommand` path (Change 1+2 above).
It's the documented Tauri v2 integration, keeps signing inside the
`tauri build` lifecycle (so the `.exe` *inside* the NSIS installer is
signed, not just the outer installer shell), and matches upstream
Tauri guidance in `v2.tauri.app/distribute/sign/windows/`.

### Change 3 — GitHub repo secrets

New secrets to add to `4neverCompany/MashupForge`:
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

(Or switch to OIDC federated credentials for no-secret auth — a
follow-up hardening, not required for v1.)

### Change 4 — IMPROVE-001 interaction

IMPROVE-001's "Linux cross-compile via `cargo-xwin`" path **cannot
co-exist with Authenticode signing**: `signtool.exe` is Windows-only.
That's not new — IMPROVE-001 already flagged this in its "Not
supported / out of scope" section. The practical consequence is:

> If MashupForge adopts IMPROVE-002, the release path **must** stay on
> `windows-latest` runners. IMPROVE-001's Linux path remains useful
> only as a dev/CI smoke-test for unsigned builds, not a release
> candidate. Both stories should be read together before merging
> either.

---

## Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Identity verification rejected / stuck in AU10TIX limbo | High | Start verification 2 weeks before any release depending on it; keep unsigned + minisign path as fallback |
| Entity not eligible (EU individual, or country outside US/CA/EU/UK) | High | Resolve eligibility question *before* creating any Azure resources; verify 4neverCompany's legal status first |
| $9.99/month recurring charge on Azure subscription | Low | Well below threshold of concern; document ownership of the billing account to avoid it expiring silently |
| CI secret leak (client secret in env) | Medium | Start with client-secret auth; migrate to GitHub OIDC federated credentials as Phase 2 once the baseline works |
| `signtool` version drift on `windows-latest` runner | Low | Pin Windows SDK via `microsoft/setup-msbuild` or explicit SDK install step; Microsoft now ships `Trusted.Signing.Client` MSI that bundles a known-good signtool |
| `trusted-signing-cli` crate unmaintained or incompatible with Tauri major version | Medium | Have the `azure/artifact-signing-action` post-build path ready as a drop-in alternative (already documented above) |
| Signing step adds 30–90s to release build | Low | One-time cost per release; well inside the existing 15–20 min Tauri build window |
| Cert rotation (daily, 3-day lifespan) surfaces as "expired signature" on customer machines | Low (misconception) | Timestamped signatures remain valid forever; the 3-day cert lifespan only limits *new* signing operations, not installed binaries. Must ensure `timestamp-rfc3161 http://timestamp.acs.microsoft.com` is present in the signCommand |
| Sub-binaries inside NSIS installer unsigned (e.g. bundled `node.exe`) | Medium | Tauri's `signCommand` signs the outer `.exe` only; if Defender/SmartScreen flag bundled executables, add a post-resource-copy pre-bundle sign step for `src-tauri/resources/node/node.exe` — defer until observed |
| Regression in SmartScreen behavior if we change publisher name later | Medium | Reputation attaches to the *identity*, not the display name. Publisher name change = reputation reset. Pick the final legal name before the first signed release |

---

## Recommendation

**Accept IMPROVE-002 as a proposal, with a two-gate rollout.**

### Gate 1 — pre-work (no code changes, no money spent)

1. **Resolve eligibility.** Confirm whether MashupForge will be signed
   under (a) 4neverCompany the legal entity, or (b) Maurice as an
   individual. Confirm the country of that entity falls in
   US/CA/EU/UK (business) or US/CA (individual).
2. **Assign an owner for the Azure subscription + Entra tenant.**
   This is a persistent billing relationship — must not land on a
   personal card that will expire.
3. **Decision record** — write the answer to (1) and (2) into
   `docs/runbook/code-signing.md` (new file). Nothing else until this
   exists.

### Gate 2 — implementation (one PR, gated behind Gate 1)

1. Complete Entra Verified ID identity verification flow (human time,
   not engineering time — 30 min of ID submission, then wait).
2. Create signing account + certificate profile in Azure Portal.
3. Create the app registration + client secret; assign
   `Certificate Profile Signer` role on the signing account.
4. Add three new GitHub secrets (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET`).
5. Land a single PR implementing Change 1 + Change 2 above:
   - `tauri.conf.json` gains `bundle.windows.signCommand`
   - `tauri-windows.yml` gains `cargo install trusted-signing-cli` step
     and the three `AZURE_*` env vars
6. Smoke-test the next tagged release on a clean Windows 11 VM:
   verify the installer runs without a SmartScreen warning from first
   click, verify `signtool verify /pa /v` on the installer shows
   Microsoft ID Verified CS certificate chain.
7. Update `docs/WINDOWS-BUILD.md` §Phase 3 to reflect completion.

This is **complex** work per the autonomic-loop rubric (release-path
change, recurring cost, new third-party identity dependency, CI
secrets surface), so it gets proposed to Hermes rather than
self-assigned. The eligibility question in Gate 1 is a decision that
only Maurice can make.

---

## Open questions for Hermes / Maurice

1. **Legal entity for signing:** 4neverCompany as a registered
   business (where?) or Maurice as an individual (must be US/CA)?
2. **Azure billing owner:** which Microsoft account / credit card
   backs the subscription? Personal or business?
3. **Publisher display name:** what string should appear in UAC
   prompts? "MashupForge", "4neverCompany", "Maurice Di Michele"?
   Changing it later resets SmartScreen reputation.
4. **OIDC vs. client secret:** do we want to set up GitHub federated
   identity from day 1 (more work, no stored secret), or start with
   client-secret auth and migrate later?
5. **Does IMPROVE-001 get shelved?** If yes to IMPROVE-002, the
   Linux cross-compile path stops being a plausible release path and
   only survives as a CI smoke-test. Confirm that's acceptable.

---

## Sources

- [Tauri v2 — Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri issue #9578 — support Azure Trusted Signing](https://github.com/tauri-apps/tauri/issues/9578)
- [Azure Artifact Signing (formerly Trusted Signing) — product page](https://azure.microsoft.com/en-us/products/artifact-signing)
- [Artifact Signing — Pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- [Trusted Signing FAQ — Microsoft Learn](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- [Quickstart: Set up Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Trusted Signing — individual developer preview announcement](https://techcommunity.microsoft.com/blog/microsoft-security-blog/trusted-signing-is-now-open-for-individual-developers-to-sign-up-in-public-previ/4273554)
- [azure/artifact-signing-action (official GitHub Action)](https://github.com/Azure/artifact-signing-action)
- [Signing integrations reference — Microsoft Learn](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
- [Melatonin — real-world Azure Trusted Signing setup notes](https://melatonin.dev/blog/code-signing-on-windows-with-azure-trusted-signing/)
- [Scott Hanselman — Automatically Signing with Trusted Signing + GitHub Actions](https://www.hanselman.com/blog/automatically-signing-a-windows-exe-with-azure-trusted-signing-dotnet-sign-and-github-actions)
- [textslashplain — Authenticode in 2025: Azure Trusted Signing](https://textslashplain.com/2025/03/12/authenticode-in-2025-azure-trusted-signing/)
