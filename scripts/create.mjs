#!/usr/bin/env node
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const templateFlag = args.indexOf('--template');
const templateName = templateFlag >= 0 ? args[templateFlag + 1] : 'app';
const templateValueIndex = templateFlag >= 0 ? templateFlag + 1 : -1;
const name = args.find((arg, index) => !arg.startsWith('--') && index !== templateValueIndex);
if (!name || name.startsWith('-')) {
  console.error('Usage: basedom create <directory> [--template app|counter]');
  process.exit(1);
}

const dest = path.resolve(name);
const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.join(here, '..', 'templates', templateName === 'counter' ? 'counter' : 'app');
await cp(template, dest, { recursive: true });

const label = path.basename(dest);
async function fill(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await fill(full);
      continue;
    }
    const text = await readFile(full, 'utf8');
    if (text.includes('__NAME__')) await writeFile(full, text.replaceAll('__NAME__', label));
  }
}
await fill(dest);
console.log(`Created ${dest}`);
console.log(`Next: cd ${label} && npm install && npm run dev`);
