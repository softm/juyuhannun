import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(root, 'public');
const errors = [];
async function walk(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.cache', '.git'].includes(entry.name)) continue;
    const current = resolve(path, entry.name);
    files.push(...(entry.isDirectory() ? await walk(current) : [current]));
  }
  return files;
}
const files = await walk(root);
for (const file of files.filter(file => /\.(mjs|js)$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) errors.push(result.stderr);
  const code = await readFile(file, 'utf8');
  for (const match of code.matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
    try { await readFile(resolve(dirname(file), match[1])); }
    catch { errors.push(`Missing module: ${relative(root, file)} → ${match[1]}`); }
  }
}
const publicFiles = files.filter(file => file.startsWith(`${publicRoot}/`));
const htmlFiles = publicFiles.filter(file => file.endsWith('.html'));
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) errors.push(`Duplicate HTML ids: ${relative(root, file)}`);
  if (/<\/option\s+/.test(html)) errors.push(`Invalid option tag: ${relative(root, file)}`);
  for (const match of html.matchAll(/(?:href|src)="(\.\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
    if (match[1] === './') continue;
    try { await readFile(resolve(dirname(file), match[1])); }
    catch { errors.push(`Missing asset: ${relative(root, file)} → ${match[1]}`); }
  }
}
const statuses = new Set(['ready', 'partial', 'awaiting_credentials', 'error']);
for (const [name, field, granularity] of [['stations', 'stations', 'station'], ['highway', 'stations', 'station'], ['averages', 'benchmarks', 'aggregate']]) {
  let data;
  try { data = JSON.parse(await readFile(resolve(publicRoot, `data/${name}.json`), 'utf8')); }
  catch { errors.push(`Missing or invalid ${name}.json`); continue; }
  if (!statuses.has(data.status) || !Array.isArray(data[field])) { errors.push(`Invalid ${name} envelope`); continue; }
  if (name === 'averages' && data.dataGranularity !== 'aggregate') errors.push('Average collection must declare aggregate granularity');
  const ids = new Set();
  for (const row of data[field]) {
    if (!row.id || ids.has(row.id)) errors.push(`Missing or duplicate identity in ${name}`);
    ids.add(row.id);
    if (row.dataGranularity && row.dataGranularity !== granularity) errors.push(`Mixed price granularity in ${name}`);
    if (granularity === 'aggregate') {
      if (row.dataGranularity !== 'aggregate' || row.unit !== 'KRW/L' || row.price !== undefined || row.prices !== undefined) errors.push('Average records cannot contain station prices');
      if (row.averagePrice !== null && !(Number.isFinite(row.averagePrice) && row.averagePrice > 0)) errors.push('Invalid average amount');
    } else {
      if (!row.name) errors.push(`Missing station name in ${name}`);
      const coordinates = Number.isFinite(row.lat) && Number.isFinite(row.lng) && row.lat >= 32 && row.lat <= 40 && row.lng >= 123 && row.lng <= 133;
      if (!coordinates && (name === 'stations' || row.lat != null || row.lng != null)) errors.push(`Invalid coordinates in ${name}`);
      for (const price of Object.values(row.prices || {})) {
        if (price.price !== null && !(Number.isFinite(price.price) && price.price > 0)) errors.push(`Invalid fuel price in ${name}`);
        if (price.unit && price.unit !== 'KRW/L') errors.push(`Invalid fuel price unit in ${name}`);
      }
    }
  }
}
for (const file of publicFiles.filter(file => /\.(js|json|html|md)$/.test(file))) {
  const content = await readFile(file, 'utf8');
  if (/(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(content)) errors.push(`Credential-like value in ${relative(root, file)}`);
  if (/[?&](?:certkey|servicekey|api_?key)=[^&\s"'<>]+/i.test(content)) errors.push(`Private API key in public URL: ${relative(root, file)}`);
}
for (const error of errors) console.error(error);
console.log(`Checked ${files.length} files, ${htmlFiles.length} pages and 3 data collections: syntax, modules, asset paths, HTML ids, price units and credential boundaries.`);
if (errors.length) process.exitCode = 1;
