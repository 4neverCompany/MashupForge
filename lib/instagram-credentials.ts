// INSTAGRAM-CRED-FIX helper. Env-first resolution so desktop reads from
// config.json-hydrated process.env and web deployments still fall through
// to the client-provided request body. Keeping the `??` chain in one
// place means routes can't silently drift off the pattern.
//
// `??` is load-bearing: /api/desktop/config PATCH deletes empty-string
// keys from config.json, so env values are either a non-empty string or
// undefined — never '' — which keeps the fallback live for web callers
// who legitimately pass creds via the request body.

// Index signature — NodeJS.ProcessEnv is `{ [key: string]: string | undefined }`,
// so a named-key interface would fail structural compatibility at the call site.
export type InstagramCredentialSources = Readonly<Record<string, string | undefined>>;

export interface InstagramCredentialBody {
  igAccountId?: string;
  accessToken?: string;
  // Unix ms when the long-lived token expires. Optional because legacy
  // configs predate the refresh flow; resolver ignores this field.
  expiresAt?: number;
}

export interface ResolvedInstagramCredentials {
  igAccountId: string;
  igAccessToken: string;
}

export function resolveInstagramCredentials(
  env: InstagramCredentialSources,
  body: InstagramCredentialBody | undefined,
): ResolvedInstagramCredentials {
  return {
    igAccountId: env.INSTAGRAM_ACCOUNT_ID ?? body?.igAccountId ?? '',
    igAccessToken: env.INSTAGRAM_ACCESS_TOKEN ?? body?.accessToken ?? '',
  };
}
