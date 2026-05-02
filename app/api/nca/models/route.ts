/**
 * GET /api/nca/models
 *
 * Thin pass-through to `nca models --json`. Used by the AI Agent settings
 * tab to render a model picker / aliases reference without re-implementing
 * nca's own enumeration logic — if upstream adds providers or aliases the
 * UI just picks them up on the next request.
 *
 * Mirrors the pattern of /api/nca/status: spawn the binary directly,
 * collect stdout, discard stderr (INFO-level startup logs nca writes
 * regardless of exit), surface a 503 when the binary cannot be spawned
 * and a 500 when it exits non-zero. Read NCA_BIN dynamically so post-
 * install env mutations are honoured (matches the rule documented in
 * lib/nca-client.ts:mmxBin).
 *
 * Same auth model as the rest of /api/nca — unauthenticated, intended
 * for the single-user desktop deployment.
 */

import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';

export const runtime = 'nodejs';

function ncaBin(): string {
  return process.env.NCA_BIN || 'nca';
}

interface SpawnResult {
  /** undefined when the binary couldn't be spawned at all (ENOENT). */
  exitCode: number | null;
  stdout: string;
  spawnError?: string;
}

function runNcaModels(timeoutMs = 5000): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: SpawnResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child;
    try {
      child = spawn(ncaBin(), ['models', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      finish({ exitCode: null, stdout: '', spawnError: e instanceof Error ? e.message : String(e) });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr?.on('data', () => { /* INFO logs — discard, same as the status route */ });

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      finish({
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        spawnError: `nca models timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.once('error', (err) => {
      clearTimeout(timer);
      finish({ exitCode: null, stdout: '', spawnError: err.message });
    });

    child.once('close', (code) => {
      clearTimeout(timer);
      finish({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      });
    });
  });
}

export async function GET(): Promise<Response> {
  const result = await runNcaModels();

  if (result.spawnError !== undefined && result.exitCode === null) {
    return NextResponse.json(
      {
        error:
          'nca binary not found. Install at /usr/local/bin/nca (or set NCA_BIN to its path) — see https://github.com/madebyaris/native-cli-ai.',
        detail: result.spawnError,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (result.exitCode !== 0) {
    return NextResponse.json(
      {
        error: `nca models exited ${result.exitCode}`,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch (e) {
    return NextResponse.json(
      {
        error: `nca models returned non-JSON: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(parsed, { headers: { 'Cache-Control': 'no-store' } });
}
