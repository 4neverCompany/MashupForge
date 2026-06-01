# Migrating to the post-lifecycle state machine

## Background

The v0.9.41 bug: image payload lifecycle is decoupled from post-metadata lifecycle.
A scheduled post can have a reference to an image blob that no longer exists.
The four 413 fixes in v0.9.41 (JPEG-92, client-side uguu, proxy through `/api/upload`,
skip mediaBase64) all worked around symptoms of this decoupling. None of them fixed
the underlying lifecycle drift.

The fix: a post-lifecycle state machine with explicit transitions, atomic persistence
at write time, and a startup reconciler that catches the broken state at read time.

This document describes the migration path for the existing 14 API routes.

## The new types

```ts
// lib/post-lifecycle/types.ts
import { PostId, ImageBlobId, type PostRecord, type PostState, type PostFailureReason } from '@/lib/post-lifecycle';

type PostState =
  | 'draft'
  | 'generating_image'
  | 'image_ready'
  | 'captioning'
  | 'caption_ready'
  | 'scheduled'
  | 'posting'
  | 'posted'      // terminal
  | 'failed';     // → can recover to 'draft'
```

Every post has a single `PostRecord` with an explicit `state` field. The state
machine is the source of truth for valid transitions:

```ts
import { transition, canTransition } from '@/lib/post-lifecycle';

// Atomic write — image blob + post metadata commit together
await storage.savePostWithBlob(post, blob);

const next = transition(post, 'image_ready', { note: 'AI image generated' });
await storage.savePostWithBlob(next, null);
```

## The atomicity contract

`savePostWithBlob` guarantees that EITHER the post record and the image blob
are both visible to subsequent reads, OR neither is. Production backends
(idb on web, sqlite on tauri desktop) reject the broken state at write time.
The InMemoryStorage is permissive in tests; the reconciler is the second line
of defense.

## Per-route migration guide

### 1. `app/api/leonardo/*` — image generation

Current behavior: returns the generated image URL to the caller, which then
manages state in scattered data structures.

Migrated behavior:
```ts
import { transition, createDraftPost, PostId } from '@/lib/post-lifecycle';

export async function POST(req: Request) {
  const { ideaId } = await req.json();
  const post = createDraftPost({ id: PostId(`post_${crypto.randomUUID()}`), ideaId });
  const advanced = transition(post, 'generating_image', { note: 'Started Leonardo gen' });
  await storage.savePostWithBlob(advanced, null);

  const result = await leonardo.generate(/* ... */);
  // ... fetch image, save blob
  const blob = await fetchAsBlob(result.url);

  const ready = transition(advanced, 'image_ready', { note: 'Leonardo done' });
  ready.imageBlobId = ImageBlobId(`blob_${crypto.randomUUID()}`);
  await storage.savePostWithBlob(ready, blob);

  return Response.json({ post: ready });
}
```

### 2. `app/api/upload/*` — uguu image upload (the v0.9.41 epicenter)

Current behavior: uploads an image to uguu, returns a URL, the post is "done".

Migrated behavior: this is the atomicity boundary. The post metadata AND the
uguu upload URL must be written together. If the upload fails, the post goes
to `failed` with `image_upload_failed` reason. If the metadata save fails,
the upload is rolled back (or marked orphaned for cleanup).

```ts
export async function POST(req: Request) {
  const { postId, imageBytes } = await req.json();
  const post = await storage.getPost(PostId(postId));
  if (!post) return new Response('Post not found', { status: 404 });

  let hostedUrl: string;
  try {
    const result = await uguu.upload(imageBytes);
    hostedUrl = result.url;
  } catch (e) {
    const failed = transition(post, 'failed', {
      reason: 'image_upload_failed',
      note: `uguu returned ${e.message}`,
    });
    await storage.savePostWithBlob(failed, null);
    return new Response('Upload failed', { status: 502 });
  }

  const advanced = transition(post, 'captioning', { note: 'Image uploaded' });
  advanced.hostedImageUrl = hostedUrl;
  await storage.savePostWithBlob(advanced, null);

  return Response.json({ post: advanced });
}
```

### 3. `app/api/social/*` — post to Instagram / Twitter

```ts
export async function POST(req: Request) {
  const { postId } = await req.json();
  const post = await storage.getPost(PostId(postId));
  if (!post) return new Response('Post not found', { status: 404 });
  if (post.state !== 'scheduled') {
    return new Response(`Cannot post: state is ${post.state}`, { status: 409 });
  }

  const posting = transition(post, 'posting');
  await storage.savePostWithBlob(posting, null);

  try {
    const result = await instagram.publish(post);
    const posted = transition(posting, 'posted', { note: result.postId });
    await storage.savePostWithBlob(posted, null);
    return Response.json({ post: posted });
  } catch (e) {
    const failed = transition(posting, 'failed', {
      reason: 'platform_rejected',
      note: e.message,
    });
    await storage.savePostWithBlob(failed, null);
    return new Response('Platform rejected', { status: 502 });
  }
}
```

### 4. `app/api/minimax-image/*` and `app/api/mmx/*` — other image providers

Same pattern as `leonardo/*`. Use `image_generation_failed` for provider-specific
failures.

### 5. `app/api/ai/prompt` and `app/api/pi` — captioning

```ts
export async function POST(req: Request) {
  const { postId, prompt } = await req.json();
  const post = await storage.getPost(PostId(postId));
  if (!post) return new Response('Post not found', { status: 404 });

  const captioning = transition(post, 'captioning');
  await storage.savePostWithBlob(captioning, null);

  try {
    const caption = await ai.complete(prompt);
    const ready = transition(captioning, 'caption_ready', { note: 'AI caption generated' });
    ready.caption = caption;
    await storage.savePostWithBlob(ready, null);
    return Response.json({ post: ready });
  } catch (e) {
    const failed = transition(captioning, 'failed', {
      reason: 'caption_failed',
      note: e.message,
    });
    await storage.savePostWithBlob(failed, null);
    return new Response('Caption failed', { status: 502 });
  }
}
```

### 6. Scheduler / cron — fire scheduled posts

```ts
// app/api/cron/scheduled-fire/route.ts
export async function POST() {
  const now = new Date().toISOString();
  const due = await storage.listPostsByState('scheduled');
  const dueNow = due.filter((p) => p.scheduledFor && p.scheduledFor <= now);

  for (const post of dueNow) {
    // Defense in depth: the reconciler should have already verified the
    // image blob exists, but check again before firing.
    if (!post.imageBlobId || !(await storage.getBlob(post.imageBlobId))) {
      const failed = transition(post, 'failed', {
        reason: 'image_missing',
        note: 'image_missing at scheduled fire time',
      });
      await storage.savePostWithBlob(failed, null);
      continue;
    }
    await fetch('/api/social/post', { method: 'POST', body: JSON.stringify({ postId: post.id }) });
  }
}
```

## Testing

Each route should have a contract test that:
1. Sets up the prerequisite state (post in the right pre-state).
2. Invokes the route handler.
3. Asserts the post is in the expected post-state.
4. Asserts any persisted state (image blob, caption, schedule) is correct.

Example test pattern:
```ts
it('upload route transitions post to captioning on success', async () => {
  const post = createDraftPost({ id: PostId('post_abc123') });
  post.imageBlobId = ImageBlobId('blob_abc123');
  post.state = 'image_ready';
  await storage.savePostWithBlob(post, makeBlob(post.id, post.imageBlobId!));

  const response = await POST(new Request('http://test', {
    method: 'POST',
    body: JSON.stringify({ postId: post.id, imageBytes: new ArrayBuffer(8) }),
  }));
  expect(response.status).toBe(200);

  const updated = await storage.getPost(post.id);
  expect(updated?.state).toBe('captioning');
  expect(updated?.hostedImageUrl).toMatch(/^https:\/\//);
});
```

## Acceptance

Migration is complete when:
- All 14 API routes use the state machine instead of ad-hoc scattered state.
- All existing tests still pass.
- New contract tests exist for each route's state transitions.
- The startup reconciler runs on app mount and logs any recovered posts.
- The RecoveryPanel surfaces failed posts to the user with reason + Recover action.

The state machine, types, and reconciler are non-breaking and ship in v1.0. The
per-route migration is a follow-up — each route is a small refactor, but there
are 14 of them and the user-facing impact is minimal until they're all done.

The critical v1.0 requirement is that the **storage backends** reject the broken
state at write time, and the **reconciler** catches any drift at startup. Those
are both done.
