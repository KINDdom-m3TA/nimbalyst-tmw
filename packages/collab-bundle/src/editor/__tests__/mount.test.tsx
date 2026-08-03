import { act, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { asTeamMemberId } from '@nimbalyst/runtime/auth/jwtScopes';
import { MarkdownCollabContentAdapter } from '@nimbalyst/runtime/sync/MarkdownCollabContentAdapter';
import { mountCollabEditor } from '../mount';
import { CollabPresenceSurface } from '../presence';
import type { CollabEditorHandle } from '../types';

const mountedHandles: CollabEditorHandle[] = [];

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let index = 0; index < 20; index++) await Promise.resolve();
  });
}

afterEach(() => {
  for (const handle of mountedHandles.splice(0)) handle.destroy();
  document.body.replaceChildren();
});

describe('in-memory collaborative editor harness', () => {
  it('paints a pre-populated Y.Doc through the provider bridge and accepts input', async () => {
    const yDocument = new Y.Doc();
    MarkdownCollabContentAdapter.seedFromFile(yDocument, '# Bundle harness\n\nPREPOPULATED-MARKER');
    const element = globalThis.document.createElement('div');
    globalThis.document.body.append(element);

    let ready = false;
    const handle = mountCollabEditor({
      element,
      source: { kind: 'in-memory', document: yDocument },
      user: {
        memberId: asTeamMemberId('member-harness'),
        name: 'Harness User',
        cursorColor: '#3366ff',
      },
      showToolbar: false,
      onReady: () => { ready = true; },
    });
    mountedHandles.push(handle);

    await settle();
    const editable = element.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(ready).toBe(true);
    expect(editable?.textContent).toContain('PREPOPULATED-MARKER');

    await act(async () => handle.insertText(' ACCEPTED-INPUT'));
    await settle();

    expect(editable?.textContent).toContain('ACCEPTED-INPUT');
    expect(handle.getMarkdown()).toContain('ACCEPTED-INPUT');
    expect(handle.getState()).toMatchObject({
      connection: 'local',
      edit: 'dirty',
      hostReadOnly: false,
      serverAccess: 'not-applicable',
      termination: null,
    });
    await expect(handle.flush()).resolves.toEqual({
      status: 'not-required',
      reason: 'in-memory',
    });
  });

  it('provides keyboard-navigable browser chrome and restores document focus on Escape', async () => {
    const yDocument = new Y.Doc();
    MarkdownCollabContentAdapter.seedFromFile(yDocument, 'Toolbar keyboard marker');
    const element = globalThis.document.createElement('div');
    globalThis.document.body.append(element);

    const handle = mountCollabEditor({
      element,
      source: { kind: 'in-memory', document: yDocument },
      user: {
        memberId: asTeamMemberId('member-keyboard'),
        name: 'Keyboard User',
        cursorColor: '#3366ff',
      },
      showToolbar: true,
    });
    mountedHandles.push(handle);
    await settle();

    const toolbar = element.querySelector<HTMLElement>('[role="toolbar"]');
    const buttons = [...(toolbar?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const editable = element.querySelector<HTMLElement>('[contenteditable="true"]');
    const contentArea = element.querySelector<HTMLElement>('.editor-scroller');
    expect(toolbar?.getAttribute('aria-label')).toBe('Formatting toolbar');
    expect(buttons.length).toBeGreaterThan(1);
    expect(contentArea?.classList.contains('select-text')).toBe(true);

    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);

    fireEvent.keyDown(buttons[1], { key: 'Escape' });
    await settle();
    expect(document.activeElement).toBe(editable);
  });

  it('announces lifecycle departure and rejoins when the document becomes active', async () => {
    const setActive = vi.spyOn(CollabPresenceSurface.prototype, 'setActive');
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get');
    const element = document.createElement('div');
    document.body.append(element);
    const handle = mountCollabEditor({
      element,
      source: { kind: 'in-memory', document: new Y.Doc() },
      user: {
        memberId: asTeamMemberId('member-lifecycle'),
        name: 'Lifecycle User',
      },
      showToolbar: false,
    });
    mountedHandles.push(handle);
    await settle();

    window.dispatchEvent(new Event('pagehide'));
    expect(setActive).toHaveBeenLastCalledWith(false);

    window.dispatchEvent(new Event('pageshow'));
    expect(setActive).toHaveBeenLastCalledWith(true);

    visibilityState.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setActive).toHaveBeenLastCalledWith(false);

    visibilityState.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setActive).toHaveBeenLastCalledWith(true);

    handle.setPresenceActive(false);
    expect(setActive).toHaveBeenLastCalledWith(false);
    handle.setPresenceActive(true);
    expect(setActive).toHaveBeenLastCalledWith(true);
    visibilityState.mockRestore();
    setActive.mockRestore();
  });
});
