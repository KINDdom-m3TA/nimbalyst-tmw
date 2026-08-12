// @vitest-environment node

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { CsvBinding } from '../csvBinding';
import { getYCsv } from '../seed';

describe('CsvBinding teardown', () => {
  it('finishes a final sync that started before the binding was destroyed', async () => {
    const yDoc = new Y.Doc();
    const yText = getYCsv(yDoc);
    const initial = 'Name,Count\nAlpha,1\n';
    const withInsertedRow = 'Name,Count\nAlpha,1\nBravo,2\n';
    yText.insert(0, initial);

    let finishSerialization: (content: string) => void = () => {};
    const serialization = new Promise<string>((resolve) => {
      finishSerialization = resolve;
    });
    const binding = new CsvBinding(yDoc, initial, {
      getCurrentCsv: () => serialization,
      onRemoteContent: () => {},
    });

    const finalSync = binding.syncNow();
    binding.destroy();
    finishSerialization(withInsertedRow);
    await finalSync;

    expect(yText.toString()).toBe(withInsertedRow);
    yDoc.destroy();
  });

  it('abandons a final sync when its real Y.Doc is destroyed during serialization', async () => {
    const yDoc = new Y.Doc();
    const yText = getYCsv(yDoc);
    const initial = 'Name,Count\nAlpha,1\n';
    const withInsertedRow = 'Name,Count\nAlpha,1\nBravo,2\n';
    yText.insert(0, initial);

    let finishSerialization: (content: string) => void = () => {};
    const serialization = new Promise<string>((resolve) => {
      finishSerialization = resolve;
    });
    const binding = new CsvBinding(yDoc, initial, {
      getCurrentCsv: () => serialization,
      onRemoteContent: () => {},
    });

    const finalSync = binding.syncNow();
    binding.destroy();
    yDoc.destroy();
    finishSerialization(withInsertedRow);

    await expect(finalSync).resolves.toBeUndefined();
    expect(yText.toString()).toBe(initial);
  });
});
