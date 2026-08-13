import { expect, test, type Page } from '@playwright/test';
import { openFileFromTree } from '../utils/testHelpers';
import { TwoClientCollabHarness } from '../utils/twoClientCollab';
import { WebConsoleClient } from '../utils/webConsoleClient';

test.skip(
  () => !process.env.RUN_COLLAB_TESTS,
  'Requires RUN_COLLAB_TESTS=1, local wrangler, and the web console checkout',
);
test.describe.configure({ mode: 'serial' });

/**
 * The cross-host sibling of `collaborative-document-types.spec.ts`.
 *
 * Same table shape, same wrangler room, but the second client is a **browser**
 * on the web console rather than a second Electron instance. That is the whole
 * point: one extension bundle now runs in two hosts, and two CRDT clients that
 * each look right in isolation can diverge without either one noticing. Only a
 * cross-host assertion catches it.
 *
 * Each row must be a type the console can actually load -- today that is the
 * pinned CSV spreadsheet. Adding the next certified type is a row here plus a
 * pin in the console's vite config; no new plumbing.
 */
interface CrossHostTypeDescriptor {
  documentType: string;
  displayName: string;
  suffix: string;
  /** Matches in BOTH hosts -- the same extension paints both. */
  editorSelector: string;
  seedContent: string;
  seedMarkers: string[];
  /**
   * Seeded cell values each host overwrites. Addressed by text, not by
   * coordinates: with a frozen column and a pinned header row, RevoGrid splits
   * the grid into sections whose `data-rgcol`/`data-rgrow` restart per section,
   * so a logical (col,row) is not a stable address -- and it is exactly the
   * sort of internals a parity test should not be re-encoding.
   */
  desktopTarget: string;
  browserTarget: string;
  readCells(page: Page): Promise<string[]>;
}

const BROWSER_MEMBER_ID = 'e2e-cross-host-browser';
const BROWSER_DISPLAY_NAME = 'Browser Rowan';
/** The name `CollabTestIdentityHandlers` gives every Electron test client. */
const DESKTOP_DISPLAY_NAME = 'Playwright User';

/**
 * The grid the user is looking at.
 *
 * Electron keeps every mode mounted and hides the inactive ones with CSS, so
 * after Share to Team the desktop page holds two `revo-grid` elements -- the
 * local file's, still open in Files mode, and the shared document's. An
 * unscoped cell scrape reads both and reports a cross-host divergence that is
 * really a second tab.
 */
function visibleGrid(page: Page) {
  return page.locator('revo-grid').filter({ visible: true }).first();
}

async function readCells(page: Page): Promise<string[]> {
  return visibleGrid(page)
    .locator('revogr-data [role="gridcell"]')
    .allTextContents()
    .then((values) => values.map((value) => value.trim()).filter(Boolean).sort());
}

/**
 * Every rendered cell that carries text, with the grid section it landed in.
 *
 * Empty cells are excluded deliberately: RevoGrid virtualizes, and an Electron
 * window and a 1440x900 browser context render a different number of blank
 * trailing cells. That difference is a viewport size, not a divergence. What
 * must match across hosts is where the *content* sits -- which section (pinned
 * column vs centre), which coordinates.
 */
async function gridFingerprint(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const grid = [...document.querySelectorAll('revo-grid')]
      .find((candidate) => candidate.getClientRects().length > 0);
    if (!grid) return [];
    const sections = [...grid.querySelectorAll('revogr-data')];
    return sections
      .map((section, sectionIndex) => ({
        sectionIndex,
        cells: [...section.querySelectorAll('[role="gridcell"]')]
          .map((cell) => ({
            col: cell.getAttribute('data-rgcol'),
            row: cell.getAttribute('data-rgrow'),
            text: (cell.textContent ?? '').trim(),
          }))
          .filter((cell) => cell.text.length > 0),
      }))
      .filter((section) => section.cells.length > 0);
  });
}

function cellLocator(page: Page, text: string) {
  return visibleGrid(page)
    .locator('revogr-data [role="gridcell"]')
    .filter({ hasText: text })
    .first();
}

async function openCellEditor(page: Page, text: string) {
  await cellLocator(page, text).dblclick();
  const input = visibleGrid(page).locator('input').filter({ visible: true });
  await expect(input).toBeVisible({ timeout: 10_000 });
  return input;
}

/**
 * Replace one cell's value. `fill` rather than typing: the cell editor opens
 * with the existing value present and the caret at the end, so typing appends,
 * and `Meta+A` is not the escape hatch -- the grid owns that accelerator and
 * closes the editor with it.
 */
async function editCell(page: Page, target: string, value: string) {
  const input = await openCellEditor(page, target);
  await input.fill(value);
  await input.press('Enter');
  await expect
    .poll(() => readCells(page), { timeout: 20_000, message: `local commit of ${value}` })
    .toContain(value);
}

interface PresenceSnapshot {
  overlays: number;
  cells: number;
  editing: number;
  labels: string[];
}

/** What one host renders for the other's live cursor. */
async function pollPresence(page: Page, timeoutMs = 30_000): Promise<PresenceSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let snapshot: PresenceSnapshot = { overlays: 0, cells: 0, editing: 0, labels: [] };
  while (Date.now() < deadline) {
    snapshot = await page.evaluate(() => ({
      overlays: document.querySelectorAll('.csv-presence-overlay').length,
      cells: document.querySelectorAll('.csv-presence-cell').length,
      editing: document.querySelectorAll('.csv-presence-cell[data-editing="true"]').length,
      labels: [...document.querySelectorAll('.csv-presence-label')]
        .map((element) => (element.textContent ?? '').trim()),
    }));
    if (snapshot.labels.length > 0) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return snapshot;
}

async function waitForCells(page: Page, markers: string[], timeout = 40_000): Promise<string[]> {
  await expect
    .poll(() => readCells(page), { timeout, message: `waiting for ${markers.join(', ')}` })
    .toEqual(expect.arrayContaining(markers));
  return readCells(page);
}

const crossHostTypes: CrossHostTypeDescriptor[] = [
  {
    documentType: 'csv',
    displayName: 'CSV Spreadsheet',
    suffix: '.csv',
    editorSelector: 'revo-grid',
    // A frozen first column and a header row, declared in the extension's own
    // metadata comment, so the pinned-section parity check below has something
    // to compare rather than asserting two identically featureless grids.
    seedContent: [
      '# nimbalyst: {"hasHeaders":true,"headerRowCount":1,"frozenColumnCount":1}',
      'Region,Name,Value',
      'North,Seeded alpha row,100',
      'South,Seeded bravo row,200',
      '',
    ].join('\n'),
    seedMarkers: ['Seeded alpha row', 'Seeded bravo row', 'North', 'South'],
    desktopTarget: 'Seeded alpha row',
    browserTarget: 'Seeded bravo row',
    readCells,
  },
];

let harness: TwoClientCollabHarness;
let webConsole: WebConsoleClient;
let teamProjectId: string;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  harness = new TwoClientCollabHarness({
    clients: ['A'],
    files: crossHostTypes.map((type) => ({
      relativePath: `cross-host-certification${type.suffix}`,
      content: type.seedContent,
      client: 'A' as const,
    })),
  });
  await harness.start();
  // The browser client runs the real project-access gate, so it needs an org
  // membership and a project grant the Electron bypass never asks for.
  teamProjectId = await harness.provisionProjectMember({
    userId: BROWSER_MEMBER_ID,
    projectId: 'cross-host-project',
    name: BROWSER_DISPLAY_NAME,
  });
  webConsole = new WebConsoleClient();
  await webConsole.start();
});

test.afterAll(async () => {
  await webConsole?.stop();
  await harness?.stop();
});

async function shareFromDesktop(type: CrossHostTypeDescriptor): Promise<string> {
  const sourceName = `cross-host-certification${type.suffix}`;
  const page = harness.clientA.page;
  await page.getByTestId('files-mode-button').click();
  // `openFileFromTree` goes straight to the workspace select handler, so on a
  // cold launch the tab opens while the sidebar is still collapsed behind the
  // AI panel -- and Share to Team is only reachable from the tree's context
  // menu. Mirrors what `openSharedMode` does for the collab sidebar.
  const fileSidebarToggle = page.getByTitle('Show Files sidebar');
  if (await fileSidebarToggle.count() > 0) await fileSidebarToggle.click();
  await openFileFromTree(page, sourceName);
  await expect(page.locator(type.editorSelector).filter({ visible: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.locator('.file-tree-name', { hasText: sourceName }).click({ button: 'right' });
  await page.getByText('Share to Team', { exact: true }).last().click();
  const shareDialog = page.getByRole('dialog', { name: 'Share to Team' });
  await expect(shareDialog).toBeVisible({ timeout: 10_000 });
  await shareDialog.getByRole('button', { name: /Share to Team$/ }).click();
  await expect(shareDialog).toBeHidden({ timeout: 30_000 });

  await harness.openSharedMode('A');
  const row = page
    .getByTestId('collab-sidebar')
    .locator('.file-tree-file')
    .filter({ hasText: sourceName });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.locator(type.editorSelector).filter({ visible: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.locator('.collab-hydration-overlay').waitFor({ state: 'hidden', timeout: 20_000 });

  const uri = await page.locator('.collab-mode .tab.active').getAttribute('title');
  const documentId = uri?.match(/:doc:(.+)$/)?.[1];
  if (!documentId) throw new Error(`Shared tab exposed no collab URI: ${uri ?? '<none>'}`);
  return documentId;
}

test('extension editors converge across an Electron and a browser host', async () => {
  test.setTimeout(420_000 * crossHostTypes.length);
  const runSuffix = harness.runId.slice(-8);

  for (const type of crossHostTypes) {
    await test.step(type.displayName, async () => {
      const documentId = await shareFromDesktop(type);
      const desktop = harness.clientA.page;

      // ---- 1. The shared document opens in the console and renders the grid.
      const browser = await webConsole.openPage({
        serverUrl: harness.serverUrl,
        orgId: harness.orgId,
        teamProjectId,
        memberId: BROWSER_MEMBER_ID,
        displayName: BROWSER_DISPLAY_NAME,
        documentId,
      });
      await expect(browser.locator(type.editorSelector)).toBeVisible({ timeout: 60_000 });
      await expect(browser.locator('.collab-editor-surface')).toHaveAttribute(
        'data-connection-state',
        'live',
        { timeout: 30_000 },
      );
      await waitForCells(browser, type.seedMarkers);

      // ---- 2. Two-way convergence on one document.
      const desktopMarker = `Desktop ${runSuffix}`;
      const browserMarker = `Browser ${runSuffix}`;
      await editCell(desktop, type.desktopTarget, desktopMarker);
      await editCell(browser, type.browserTarget, browserMarker);
      const [desktopCells, browserCells] = await Promise.all([
        waitForCells(desktop, [desktopMarker, browserMarker]),
        waitForCells(browser, [desktopMarker, browserMarker]),
      ]);
      // Structure first, so a failure names WHERE the two hosts differ rather
      // than only that a flat cell list did.
      const [desktopGrid, browserGrid] = await Promise.all([
        gridFingerprint(desktop),
        gridFingerprint(browser),
      ]);
      console.log(`[cross-host] desktop grid: ${JSON.stringify(desktopGrid)}`);
      console.log(`[cross-host] browser grid: ${JSON.stringify(browserGrid)}`);
      // The assertion that only a cross-host run can make. Each host showing
      // its own edit proves nothing about the other's document state.
      expect(desktopCells).toEqual(browserCells);

      // ---- 3. Presence across hosts. The label only renders for an *editing*
      // collaborator, so each side opens a cell editor and the other reads the
      // name off the overlay -- covering `selectedCell` and `editingCell`.
      const browserEditor = await openCellEditor(browser, browserMarker);
      const desktopSeen = await pollPresence(desktop);
      await browserEditor.press('Escape');

      const desktopEditor = await openCellEditor(desktop, desktopMarker);
      const browserSeen = await pollPresence(browser);
      await desktopEditor.press('Escape');

      // Both directions reported together: a one-way failure and a dead
      // awareness channel look identical from a single assertion. The asserts
      // are deferred to the end of the step so a presence regression does not
      // hide the state of everything after it.
      console.log(`[cross-host] desktop saw browser presence: ${JSON.stringify(desktopSeen)}`);
      console.log(`[cross-host] browser saw desktop presence: ${JSON.stringify(browserSeen)}`);

      // ---- 5. Frozen column and header row render identically in both hosts.
      // Parity, not a hardcoded layout: the claim under test is that one editor
      // in two hosts produces one result, and a fingerprint asserted against a
      // literal would just re-encode RevoGrid's internals here.
      expect(desktopGrid).toEqual(browserGrid);

      // ---- 4. Creating a shared document of an extension type from the
      // console is deliberately NOT offered: nothing seeds the new room from
      // the manifest's default content, so it would create documents that open
      // empty (`webDocumentTypeCatalog.ts`, `sharedCreate: false`). Asserted so
      // the gap is a recorded decision rather than an untested assumption.
      const listPage = await webConsole.openPage({
        serverUrl: harness.serverUrl,
        orgId: harness.orgId,
        teamProjectId,
        memberId: BROWSER_MEMBER_ID,
        displayName: BROWSER_DISPLAY_NAME,
      });
      await listPage.getByTitle('New document').click();
      await expect(listPage.getByRole('menuitem', { name: /Markdown/ })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        listPage.getByRole('menuitem', { name: new RegExp(type.displayName) }),
      ).toHaveCount(0);
      await listPage.close();

      // ---- 3 (asserted). Presence must cross in BOTH directions, carrying
      // `selectedCell` and `editingCell`.
      //
      // Browser -> desktop used to deliver only the selection. Not a wire or
      // host-boundary defect: the extension's own selection publish asserted
      // `editingCell: null`, RevoGrid emitted a focus event 56ms after the
      // editor opened, and DocumentSync's 2Hz awareness coalescing dropped the
      // editing frame in between -- so the desktop painted a presence cell with
      // `data-editing` unset, and the 5s presence heartbeat kept re-affirming
      // it. See `collab/localPresence.ts` in the CSV extension.
      expect(browserSeen.labels).toEqual([DESKTOP_DISPLAY_NAME]);
      expect(desktopSeen.labels).toEqual([BROWSER_DISPLAY_NAME]);
    });
  }
});
