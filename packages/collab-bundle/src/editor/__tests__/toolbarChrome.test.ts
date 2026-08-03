import { afterEach, describe, expect, it } from 'vitest';

import { installBrowserEditorChrome } from '../toolbarChrome';

/** The runtime toolbar's shape, reduced to what the decoration reacts to. */
function renderToolbar(): { element: HTMLElement; toolbar: HTMLElement } {
  const element = document.createElement('div');
  element.innerHTML = `
    <div class="editor-scroller"></div>
    <div class="toolbar">
      <button class="toolbar-item" aria-label="Undo"></button>
      <button class="toolbar-item" aria-label="Redo" disabled></button>
      <div class="toolbar-formatting">
        <button class="toolbar-item" aria-label="Bold"></button>
        <button class="toolbar-item active" aria-label="Italic"></button>
      </div>
      <div class="toolbar-insert">
        <button class="toolbar-item" aria-label="Insert"></button>
      </div>
    </div>
    <div class="collab-cursors-container"></div>
  `;
  document.body.append(element);
  return { element, toolbar: element.querySelector('.toolbar')! };
}

const byLabel = (toolbar: HTMLElement, label: string): HTMLButtonElement => (
  toolbar.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
);

const tabStops = (toolbar: HTMLElement): string[] => (
  [...toolbar.querySelectorAll<HTMLButtonElement>('button')]
    .filter((button) => button.tabIndex === 0)
    .map((button) => button.getAttribute('aria-label') ?? '')
);

const teardowns: (() => void)[] = [];

afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  document.body.replaceChildren();
});

describe('browser editor chrome', () => {
  it('leaves the toolbar a single tab stop and follows focus within it', () => {
    const { element, toolbar } = renderToolbar();
    teardowns.push(installBrowserEditorChrome(element));

    // Without this the toolbar is one tab stop per button and a keyboard user
    // pays ten Tab presses to reach the document.
    expect(tabStops(toolbar)).toEqual(['Undo']);

    byLabel(toolbar, 'Bold').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(tabStops(toolbar)).toEqual(['Bold']);
  });

  it('never parks the tab stop on a disabled control', () => {
    const { element, toolbar } = renderToolbar();
    byLabel(toolbar, 'Undo').disabled = true;
    teardowns.push(installBrowserEditorChrome(element));

    expect(tabStops(toolbar)).toEqual(['Bold']);
  });

  it('mirrors the runtime active class onto aria-pressed as the selection moves', async () => {
    const { element, toolbar } = renderToolbar();
    teardowns.push(installBrowserEditorChrome(element));

    expect(byLabel(toolbar, 'Bold').getAttribute('aria-pressed')).toBe('false');
    expect(byLabel(toolbar, 'Italic').getAttribute('aria-pressed')).toBe('true');
    // Commands and menus are not toggles and must not claim a pressed state.
    expect(byLabel(toolbar, 'Undo').hasAttribute('aria-pressed')).toBe(false);

    byLabel(toolbar, 'Bold').classList.add('active');
    byLabel(toolbar, 'Italic').classList.remove('active');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(byLabel(toolbar, 'Bold').getAttribute('aria-pressed')).toBe('true');
    expect(byLabel(toolbar, 'Italic').getAttribute('aria-pressed')).toBe('false');
  });

  it('hides the remote cursor layer from assistive tech', () => {
    const { element } = renderToolbar();
    teardowns.push(installBrowserEditorChrome(element));

    expect(element.querySelector('.collab-cursors-container')?.getAttribute('aria-hidden'))
      .toBe('true');
  });
});
