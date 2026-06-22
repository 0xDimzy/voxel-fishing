#!/usr/bin/env node
// scripts/_append.js — surgical append helper for JSON5 accounts files.
//
// Preserves comments by:
//   1. Finding the root array's `[` (first `[` on its own line) and `]`
//      (last `]` on its own line).
//   2. Inserting a comma + new entry before the closing `]`.
//
// Handles:
//   - Empty array `[]` → becomes `[\n  { ... }\n]`
//   - Non-empty array `[ { ... } ]` → becomes `[ { ... },\n  { ... }\n]`
//   - JSON5 syntax (// comments are kept verbatim outside the array)
//
import fs from 'fs';

export function appendAccountToJson5(filePath, newEntryObj) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const lines = txt.split('\n');

  // Find root array start: first line that's just `[` (with optional whitespace).
  const openIdx = lines.findIndex((l) => /^\s*\[\s*$/.test(l));
  if (openIdx < 0) {
    throw new Error(`${filePath}: no root array found (line with just "[")`);
  }

  // Find root array end: last line that's just `]` (with optional whitespace).
  let closeIdx = -1;
  for (let i = lines.length - 1; i > openIdx; i--) {
    if (/^\s*\]\s*$/.test(lines[i])) { closeIdx = i; break; }
  }
  if (closeIdx < 0) {
    throw new Error(`${filePath}: no closing ] found`);
  }

  // Serialize new entry as a JSON5 array element with 2-space indent.
  const entryIndented = JSON.stringify(newEntryObj, null, 2)
    .split('\n').map((l) => '  ' + l).join('\n');

  // Check if array already has content (any non-whitespace line between `[` and `]`)
  const innerLines = lines.slice(openIdx + 1, closeIdx);
  const hasContent = innerLines.some((l) => /\S/.test(l));

  // Build the inserted block: comma-prefix if non-empty, then entry, then trailing newline.
  const insertionBlock = hasContent
    ? `,\n${entryIndented}\n`
    : `${entryIndented}\n`;

  // Splice before the closing `]`.
  const result = [
    ...lines.slice(0, closeIdx),
    ...insertionBlock.split('\n').slice(0, -1),  // exclude trailing empty from split
    lines[closeIdx],
  ].join('\n');

  fs.writeFileSync(filePath, result, { mode: 0o600 });
}