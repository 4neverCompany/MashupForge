/**
 * Tests for lib/higgsfield/token-store.ts — AES-GCM round-trip +
 * IDB persistence (idb-keyval) + token-expiry helper.
 *
 * Uses fake-indexeddb (already in the project's devDeps) so the
 * IDB code path runs under happy-dom. The encryption is
 * platform-deterministic (Node's `crypto` in tests) so the same
 * key can encrypt + decrypt within one process.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  encryptTokens,
  decryptTokens,
  isTokenExpiringSoon,
  saveTokens,
  loadTokens,
  clearTokens,
  type StoredTokens,
} from '@/lib/higgsfield/token-store';

const sampleTokens: StoredTokens = {
  accessToken: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
  refreshToken: 'rt-abc-123',
  accessTokenExpiresAt: Date.now() + 3600_000,
  email: 'user@example.com',
  orgId: 'org-7',
  name: 'MashupForge User',
};

describe('encryptTokens + decryptTokens (round-trip)', () => {
  it('decrypts back to the original plaintext', () => {
    const packed = encryptTokens('hello world');
    expect(decryptTokens(packed)).toBe('hello world');
  });
  it('JSON round-trips a realistic token bundle', () => {
    const json = JSON.stringify(sampleTokens);
    const packed = encryptTokens(json);
    expect(decryptTokens(packed)).toBe(json);
  });
  it('produces a v1-prefixed packed string (versioning)', () => {
    const packed = encryptTokens('x');
    expect(packed.startsWith('v1.')).toBe(true);
  });
  it('two encryptions of the same plaintext produce different ciphertexts (random IV)', () => {
    const a = encryptTokens('same');
    const b = encryptTokens('same');
    expect(a).not.toBe(b);
    expect(decryptTokens(a)).toBe('same');
    expect(decryptTokens(b)).toBe('same');
  });
  it('returns null for malformed input', () => {
    expect(decryptTokens('not-a-packed-string')).toBeNull();
    expect(decryptTokens('v1.a.b.c.d')).toBeNull();
    expect(decryptTokens('')).toBeNull();
  });
  it('returns null for tampered ciphertext (AES-GCM auth tag mismatch)', () => {
    const packed = encryptTokens('original');
    // Flip a byte in the MIDDLE of the ciphertext segment — a more
    // reliable way to force an auth tag mismatch than tweaking the
    // last base64url char (which is a 6-bit boundary, occasionally
    // rounds back to a valid bit pattern under GCM's truncated hash).
    const parts = packed.split('.');
    const mid = Math.floor(parts[3].length / 2);
    const midChar = parts[3].charAt(mid);
    // base64url alphabet is A-Z, a-z, 0-9, -, _ — pick a char that's
    // guaranteed to differ from the current one.
    parts[3] = parts[3].slice(0, mid) + (midChar === 'A' ? 'B' : 'A') + parts[3].slice(mid + 1);
    expect(decryptTokens(parts.join('.'))).toBeNull();
  });
});

describe('isTokenExpiringSoon', () => {
  it('returns false when the token has more than 60s of life left', () => {
    const tokens: StoredTokens = {
      accessToken: 't',
      refreshToken: 'r',
      accessTokenExpiresAt: Date.now() + 600_000,
    };
    expect(isTokenExpiringSoon(tokens)).toBe(false);
  });
  it('returns true when the token has less than 60s of life left', () => {
    const tokens: StoredTokens = {
      accessToken: 't',
      refreshToken: 'r',
      accessTokenExpiresAt: Date.now() + 30_000,
    };
    expect(isTokenExpiringSoon(tokens)).toBe(true);
  });
  it('returns false when expiry is unknown (0) — assume valid, try the call', () => {
    const tokens: StoredTokens = {
      accessToken: 't',
      refreshToken: 'r',
      accessTokenExpiresAt: 0,
    };
    expect(isTokenExpiringSoon(tokens)).toBe(false);
  });
});

describe('IDB-backed save / load / clear (happy-dom + fake-indexeddb)', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('saveTokens then loadTokens returns the same bundle', async () => {
    await saveTokens(sampleTokens);
    const loaded = await loadTokens();
    expect(loaded).not.toBeNull();
    expect(loaded?.accessToken).toBe(sampleTokens.accessToken);
    expect(loaded?.refreshToken).toBe(sampleTokens.refreshToken);
    expect(loaded?.email).toBe(sampleTokens.email);
    expect(loaded?.orgId).toBe(sampleTokens.orgId);
  });

  it('loadTokens returns null when nothing is stored', async () => {
    expect(await loadTokens()).toBeNull();
  });

  it('clearTokens removes the stored entry', async () => {
    await saveTokens(sampleTokens);
    expect(await loadTokens()).not.toBeNull();
    await clearTokens();
    expect(await loadTokens()).toBeNull();
  });
});
