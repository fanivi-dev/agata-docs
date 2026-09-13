import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const SKIP_PREFIXES = ['/api-reference/'];

function collectNavPages(node, pages = []) {
  if (!node || typeof node !== 'object') {
    return pages;
  }
  if (Array.isArray(node.pages)) {
    for (const page of node.pages) {
      if (typeof page === 'string') {
        pages.push(page);
      } else {
        collectNavPages(page, pages);
      }
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      collectNavPages(value, pages);
    }
  }
  return pages;
}

function prettyHref(slug) {
  if (slug === 'index') {
    return '/';
  }
  if (slug.endsWith('/index')) {
    return `/${slug.slice(0, -'/index'.length)}`;
  }
  return `/${slug}`;
}

function normalizeHref(raw) {
  const [withoutHash] = raw.split('#');
  if (
    !withoutHash ||
    withoutHash.startsWith('http') ||
    withoutHash.startsWith('mailto:')
  ) {
    return null;
  }
  if (!withoutHash.startsWith('/')) {
    return null;
  }
  if (SKIP_PREFIXES.some((prefix) => withoutHash.startsWith(prefix))) {
    return null;
  }
  const trimmed = withoutHash.replace(/\/+$/, '') || '/';
  return trimmed.replace(/\.mdx?$/, '');
}

async function listMdxFiles(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'scripts' ||
        entry.name === 'openapi' ||
        entry.name.startsWith('.')
      ) {
        continue;
      }
      await listMdxFiles(full, acc);
      continue;
    }
    if (entry.name.endsWith('.mdx')) {
      acc.push(full);
    }
  }
  return acc;
}

const LINK_RE = /(?:\]\(|href=["'])(\/[^"' )\s]+)/g;

const docsJson = JSON.parse(
  await readFile(path.join(docsRoot, 'docs.json'), 'utf8')
);
const navPages = [...new Set(collectNavPages(docsJson.navigation))];
const missingFiles = [];
const knownHrefs = new Set(['/']);

for (const slug of navPages) {
  const file = path.join(docsRoot, `${slug}.mdx`);
  try {
    await readFile(file);
  } catch {
    missingFiles.push(slug);
  }
  knownHrefs.add(prettyHref(slug));
  knownHrefs.add(`/${slug}`);
}

const mdxFiles = await listMdxFiles(docsRoot);
for (const file of mdxFiles) {
  const rel = path
    .relative(docsRoot, file)
    .replace(/\\/g, '/')
    .replace(/\.mdx$/, '');
  knownHrefs.add(prettyHref(rel));
  knownHrefs.add(`/${rel}`);
}

const broken = [];
for (const file of mdxFiles) {
  const source = await readFile(file, 'utf8');
  const rel = path.relative(docsRoot, file);
  for (const match of source.matchAll(LINK_RE)) {
    const href = normalizeHref(match[1]);
    if (!href) {
      continue;
    }
    if (!knownHrefs.has(href)) {
      broken.push(`${rel} → ${href}`);
    }
  }
}

if (missingFiles.length > 0 || broken.length > 0) {
  for (const slug of missingFiles) {
    console.error(`missing page file: ${slug}.mdx`);
  }
  for (const entry of broken) {
    console.error(`broken link: ${entry}`);
  }
  process.exit(1);
}

console.log(
  `docs links ok (${navPages.length} nav pages, ${mdxFiles.length} mdx)`
);
