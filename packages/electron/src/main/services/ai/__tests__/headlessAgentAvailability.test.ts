// @vitest-environment node
/**
 * The default on/off state for these two providers is decided by the machine.
 * The hazard that shape carries is well known here: persist the decision at
 * first boot and the app overrides a user who turned the provider off, with
 * the bug only appearing on launch two.
 *
 * These tests pin the property that makes that impossible — detection is a
 * *fallback*, never a write — plus the sign-in rules, which are the difference
 * between "usable agent" and "agent that fails on the first turn".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { decideAvailability, __resetHeadlessAgentAvailabilityForTests } from '../headlessAgentAvailability';
import { resolveProviderEnabled } from '../modelEnablementFilter';

const EXE = '/Users/fixture/.local/bin/grok';

describe('decideAvailability', () => {
  it('treats a missing binary as unavailable', () => {
    expect(decideAvailability('grok-build', {})).toEqual({ installed: false, signedIn: false });
  });

  it('reads sign-out from output, not exit code', () => {
    // `grok models` exits 0 while printing "You are not authenticated", and
    // `cursor-agent status` exits 0 either way -- so the text is the only signal.
    expect(decideAvailability('grok-build', {
      executablePath: EXE,
      authOutput: 'You are not authenticated.\n\nDefault model: grok-4.6',
    })).toMatchObject({ installed: true, signedIn: false });

    expect(decideAvailability('cursor-agent', {
      executablePath: EXE,
      authOutput: ' Not logged in',
    })).toMatchObject({ installed: true, signedIn: false });
  });

  it('treats an unrecognized success message as signed in', () => {
    // Matched negatively on purpose: a vendor rewording their success string
    // must not silently disable the provider for everyone.
    expect(decideAvailability('grok-build', {
      executablePath: EXE,
      authOutput: 'You are logged in with grok.com.',
    })).toMatchObject({ installed: true, signedIn: true });

    expect(decideAvailability('cursor-agent', {
      executablePath: EXE,
      authOutput: 'Signed in as fixture@example.com (via some new phrasing)',
    })).toMatchObject({ installed: true, signedIn: true });
  });

  it('treats a CLI that would not run as unusable', () => {
    expect(decideAvailability('grok-build', { executablePath: EXE, authFailed: true }))
      .toMatchObject({ installed: true, signedIn: false });
  });
});

describe('resolveProviderEnabled for detected-default providers', () => {
  beforeEach(() => {
    __resetHeadlessAgentAvailabilityForTests();
  });

  it('is off before detection has run, so startup never blocks on a probe', () => {
    expect(resolveProviderEnabled('grok-build', undefined)).toBe(false);
  });

  it('turns on once the CLI is detected and signed in, with nothing stored', () => {
    __resetHeadlessAgentAvailabilityForTests({
      'grok-build': { installed: true, signedIn: true, executablePath: EXE },
    });
    expect(resolveProviderEnabled('grok-build', undefined)).toBe(true);
    // Installed but signed out is NOT enough: it would put an agent in the
    // picker that errors on the user's first turn.
    __resetHeadlessAgentAvailabilityForTests({
      'grok-build': { installed: true, signedIn: false, executablePath: EXE },
    });
    expect(resolveProviderEnabled('grok-build', undefined)).toBe(false);
  });

  it('never overrides an explicit choice, on either launch', () => {
    // The second-launch case. Detection says "available" every time, so if it
    // could win, a user who turned the provider off would find it back on
    // after every restart -- forever, and only ever visibly on launch two.
    __resetHeadlessAgentAvailabilityForTests({
      'cursor-agent': { installed: true, signedIn: true, executablePath: EXE },
    });
    for (const launch of [1, 2, 3]) {
      expect(resolveProviderEnabled('cursor-agent', { enabled: false }), `launch ${launch}`).toBe(false);
    }

    // And the converse: explicitly on stays on when the CLI goes away, so the
    // user sees the provider's own "not installed" message instead of it
    // silently vanishing from settings.
    __resetHeadlessAgentAvailabilityForTests();
    expect(resolveProviderEnabled('cursor-agent', { enabled: true })).toBe(true);
  });

  it('leaves every other provider on its static default', () => {
    __resetHeadlessAgentAvailabilityForTests({
      'grok-build': { installed: true, signedIn: true, executablePath: EXE },
    });
    expect(resolveProviderEnabled('claude-code', undefined)).toBe(true);
    expect(resolveProviderEnabled('claude-code-cli', undefined)).toBe(false);
    expect(resolveProviderEnabled('opencode', undefined)).toBe(false);
  });
});
