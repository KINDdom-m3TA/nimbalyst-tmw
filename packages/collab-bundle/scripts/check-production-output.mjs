#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(packageRoot, 'dist');
const artifactExtensions = new Set(['.css', '.js', '.json', '.map']);

const artifactFiles = fs.readdirSync(distRoot, { recursive: true })
  .filter((relativePath) => artifactExtensions.has(path.extname(relativePath)));

const forbiddenOutput = [
  { label: 'development JSX runtime', pattern: 'react/jsx-dev-runtime' },
  { label: 'absolute macOS user path', pattern: '/Users/' },
];

const violations = forbiddenOutput.flatMap(({ label, pattern }) => artifactFiles.flatMap((relativePath) => {
  const source = fs.readFileSync(path.join(distRoot, relativePath), 'utf8');
  return source.includes(pattern) ? [`${label}: ${relativePath}`] : [];
}));

if (violations.length > 0) {
  throw new Error(`production bundle contains forbidden output:\n${violations.join('\n')}`);
}

console.log(
  `[collab-bundle] production output clean (${artifactFiles.length} assets; no react/jsx-dev-runtime or /Users/ paths).`,
);
