// PATH: scripts/rename-visible-branding.mjs
/**
 * Rename seguro do texto visível: "Bolt" -> "Kodora"
 * - Só troca o "Bolt" com B maiúsculo (texto de UI). Tokens e classes usam "bolt" minúsculo e ficam intactos.
 * - Ignora node_modules, build/dist, .git etc.
 * - Modo --check: só lista o que seria alterado.  Modo --write: aplica as mudanças.
 *
 * Uso:
 *   pnpm brand:check
 *   pnpm brand:apply
 */
import fg from 'fast-glob';
import fs from 'node:fs/promises';
import path from 'node:path';

const WRITE = process.argv.includes('--write');

const globs = ['**/*.{md,mdx,html,js,jsx,ts,tsx,json}'];

const ignore = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.husky/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.astro/**',
  '**/coverage/**',
  '**/*.lock',
  '**/pnpm-lock.yaml',
];

const shouldSkip = (file) => {
  // Evita mexer de novo no próprio package.json (já rebatizado manualmente)
  if (path.basename(file) === 'package.json') {
    return true;
  }

  // Evita CSS/SCSS (tokens/vars)
  if (/\.(css|scss|sass)$/.test(file)) {
    return true;
  }

  return false;
};

// Regex exata com borda de palavra: só "Bolt" (B maiúsculo)
const RX = /\bBolt\b/g;

let changed = 0;
let filesChanged = 0;

const files = await fg(globs, { ignore, dot: true });

for (const file of files) {
  if (shouldSkip(file)) {
    continue;
  }

  const buf = await fs.readFile(file, 'utf8');

  // Skip se não contém "Bolt"
  if (!buf.includes('Bolt')) {
    continue;
  }

  /*
   * Heurística extra: pula linhas com domínios/strings sensíveis (ex.: bolt.diy)
   * Aqui é simples: trocamos apenas a palavra isolada "Bolt".
   */
  const next = buf.replace(RX, 'Kodora');

  if (next !== buf) {
    if (WRITE) {
      await fs.writeFile(file, next, 'utf8');
    }

    filesChanged++;

    const diffCount = (buf.match(RX) || []).length;
    changed += diffCount;
    console.log(`${WRITE ? '✍️  changed' : '🔎 would change'}: ${file}  (+${diffCount})`);
  }
}

console.log(`${WRITE ? '✅ applied' : 'ℹ️  dry-run'}: ${filesChanged} files, ${changed} replacements`);

if (!WRITE) {
  console.log('Run: pnpm brand:apply  to write changes.');
}
