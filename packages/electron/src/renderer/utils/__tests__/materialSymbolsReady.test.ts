import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  MATERIAL_SYMBOLS_FONT,
  MATERIAL_SYMBOLS_SAMPLE,
  waitForMaterialSymbols,
} from '../materialSymbolsReady';

describe('waitForMaterialSymbols', () => {
  it('loads a representative ligature before startup rendering continues', async () => {
    const loadedFace = {} as FontFace;
    const load = vi.fn().mockResolvedValue([loadedFace]);

    await expect(waitForMaterialSymbols({ load })).resolves.toBeUndefined();

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(
      MATERIAL_SYMBOLS_FONT,
      MATERIAL_SYMBOLS_SAMPLE,
    );
  });

  it('fails startup when the bundled icon font cannot be resolved', async () => {
    const load = vi.fn().mockResolvedValue([]);

    await expect(waitForMaterialSymbols({ load })).rejects.toThrow(
      'Material Symbols font failed to load',
    );
  });

  it('uses the renderer-bundled font instead of a remote stylesheet', () => {
    const rendererCssUrl = new URL('../../index.css', import.meta.url);
    const bundledFontUrl = new URL(
      '../../assets/fonts/material-symbols-outlined.woff2',
      import.meta.url,
    );
    const rendererCss = readFileSync(rendererCssUrl, 'utf8');

    expect(rendererCss).toContain(
      "src: url('./assets/fonts/material-symbols-outlined.woff2')",
    );
    expect(rendererCss).not.toContain('fonts.googleapis.com');
    expect(existsSync(bundledFontUrl)).toBe(true);
  });
});
