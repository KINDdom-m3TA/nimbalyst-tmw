/**
 * Accessibility decoration for the runtime toolbar as it appears in a browser
 * tab.
 *
 * The toolbar itself is the shared runtime component; this bundle owns the
 * browser presentation of it. Everything here is additive DOM decoration so a
 * host page gets the ARIA toolbar pattern without a browser-only fork of the
 * toolbar. Two of these — `aria-pressed` on the format toggles and roving
 * `tabindex` — are gaps in the shared component and should eventually move
 * there so desktop benefits too.
 */

const TOGGLE_BUTTON_SELECTOR = '.toolbar-formatting button';

/** A button is reachable only if neither it nor any wrapper is display:none. */
export function isRenderedToolbarButton(
  button: HTMLButtonElement,
  toolbar: HTMLElement,
): boolean {
  let element: HTMLElement | null = button;
  while (element && element !== toolbar) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    element = element.parentElement;
  }
  return true;
}

function toolbarButtons(toolbar: HTMLElement): HTMLButtonElement[] {
  return [...toolbar.querySelectorAll<HTMLButtonElement>('button')];
}

/**
 * Mirror the runtime's `active` class onto `aria-pressed`.
 *
 * The format buttons convey their on/off state only through a background
 * color, so a screen-reader user pressing Bold hears "Bold, button" whether or
 * not the selection is already bold. These five are genuine toggles; the rest
 * of the toolbar is commands and menus, which must not get `aria-pressed`.
 */
function syncPressedState(toolbar: HTMLElement): void {
  for (const button of toolbar.querySelectorAll<HTMLButtonElement>(TOGGLE_BUTTON_SELECTOR)) {
    const pressed = button.classList.contains('active') ? 'true' : 'false';
    if (button.getAttribute('aria-pressed') !== pressed) {
      button.setAttribute('aria-pressed', pressed);
    }
  }
}

/**
 * Roving tabindex over the toolbar.
 *
 * `role="toolbar"` promises one tab stop with arrow navigation inside it.
 * Without this every button is its own tab stop, so a keyboard user has to
 * press Tab ten times to get from the top of the page into the document.
 */
class RovingTabIndex {
  private target: HTMLButtonElement | null = null;

  constructor(private readonly toolbar: HTMLElement) {}

  sync(): void {
    if (!this.isUsableTarget(this.target)) this.target = this.pickTarget();
    for (const button of toolbarButtons(this.toolbar)) {
      const tabIndex = button === this.target ? 0 : -1;
      if (button.tabIndex !== tabIndex) button.tabIndex = tabIndex;
    }
  }

  moveTo(button: HTMLButtonElement): void {
    if (button === this.target) return;
    this.target = button;
    this.sync();
  }

  /** Only the current target is tested per mutation, so this stays cheap. */
  private isUsableTarget(button: HTMLButtonElement | null): button is HTMLButtonElement {
    return button !== null
      && button.isConnected
      && !button.disabled
      && isRenderedToolbarButton(button, this.toolbar);
  }

  private pickTarget(): HTMLButtonElement | null {
    return toolbarButtons(this.toolbar).find((button) => this.isUsableTarget(button)) ?? null;
  }
}

/**
 * Decorate the mounted editor chrome. Returns a teardown for the observers.
 */
export function installBrowserEditorChrome(element: HTMLElement): () => void {
  element.querySelector<HTMLElement>('.editor-scroller')?.classList.add('select-text');
  // Remote carets and their name labels are a visual echo of information the
  // participant list and the presence announcements already carry. Left
  // exposed they inject collaborators' names into the middle of the prose a
  // screen reader is reading, with no indication of what they are.
  element.querySelector<HTMLElement>('.collab-cursors-container')
    ?.setAttribute('aria-hidden', 'true');

  const toolbar = element.querySelector<HTMLElement>('.toolbar');
  if (!toolbar) return () => {};
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Formatting toolbar');

  const roving = new RovingTabIndex(toolbar);
  const sync = (): void => {
    syncPressedState(toolbar);
    roving.sync();
  };
  sync();

  // The runtime rewrites `class` on every selection change and adds or removes
  // whole groups when the block type changes, so the decoration has to follow
  // rather than run once. `aria-pressed` and `tabindex` are deliberately
  // outside the observed attribute filter, so these writes cannot re-enter.
  const observer = new MutationObserver(sync);
  observer.observe(toolbar, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'disabled'],
  });

  const handleFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (target instanceof HTMLButtonElement && toolbar.contains(target)) {
      roving.moveTo(target);
    }
  };
  toolbar.addEventListener('focusin', handleFocusIn);

  return () => {
    observer.disconnect();
    toolbar.removeEventListener('focusin', handleFocusIn);
  };
}
