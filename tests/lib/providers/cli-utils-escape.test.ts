/**
 * V1.4.5-SHELL-INJECTION: unit tests for the cmd.exe escaping helpers
 * that replaced raw `shell: true` for Windows .cmd/.bat shims.
 */
import { describe, it, expect } from 'vitest'
import {
  escapeCmdArgument,
  buildWindowsShimSpawn,
} from '@/lib/providers/cli-utils'

describe('escapeCmdArgument', () => {
  it('quotes a plain prompt (spaces caret-escaped like cross-spawn — harmless to cmd)', () => {
    expect(escapeCmdArgument('hello world', false)).toBe('^"hello^ world^"')
  })

  it('caret-escapes cmd metacharacters so they cannot break out', () => {
    const out = escapeCmdArgument('a & del C:\\x | b', true)
    // every & and | must be caret-escaped (doubled for .cmd targets)
    expect(out).not.toMatch(/[^^]&/)
    expect(out).not.toMatch(/[^^]\|/)
  })

  it('escapes embedded double quotes', () => {
    const out = escapeCmdArgument('say "hi"', false)
    expect(out).toContain('\\^"hi\\^"')
  })

  it('doubles trailing backslashes so the closing quote survives', () => {
    const out = escapeCmdArgument('C:\\path\\', false)
    expect(out).toContain('C:\\path\\\\')
  })
})

describe('buildWindowsShimSpawn', () => {
  it('passes non-shim binaries through untouched (argv array, no shell)', () => {
    const plan = buildWindowsShimSpawn('higgsfield', ['generate', '--prompt', 'a & b'])
    expect(plan.file).toBe('higgsfield')
    expect(plan.args).toEqual(['generate', '--prompt', 'a & b'])
    expect(plan.windowsVerbatimArguments).toBe(false)
  })

  it('passes .cmd through untouched on POSIX (spawnNeedsShell is win32-only)', () => {
    if (process.platform === 'win32') return
    const plan = buildWindowsShimSpawn('mmx.cmd', ['--prompt', 'x'])
    expect(plan.file).toBe('mmx.cmd')
    expect(plan.windowsVerbatimArguments).toBe(false)
  })
})
