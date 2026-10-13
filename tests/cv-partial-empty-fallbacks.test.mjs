// tests/cv-partial-empty-fallbacks.test.mjs
//
// Empty issuer/year slots must be omitted so extractors do not invent a blank
// date. ORG_EMPTY / YEAR_EMPTY still exist so parsePartial can resolve them.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, run, NODE, ROOT, lastRunFailure } from './helpers.mjs';

console.log('\nbuild-cv-html.mjs - empty cert/award slots are omitted');

const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Mixed Rows', email: 'mixed@example.com' },
  summary: 'Summary.',
  competencies: ['Competency'],
  experience: [{ company: 'Corp', role: 'Engineer', dates: '2024 - Present', bullets: ['Did a thing'] }],
  certifications: [
    { title: 'Cert both', org: 'Issuer', year: '2024' },
    { title: 'Cert no org', year: '2023' },
    { title: 'Cert no year', org: 'Issuer' },
    { title: 'Cert neither' },
  ],
  awards: [
    { title: 'Award both', org: 'Body', year: '2022' },
    { title: 'Award no org', year: '2021' },
    { title: 'Award no year', org: 'Body' },
  ],
  skills: [
    { category: 'Languages', items: ['JavaScript'] },
    { items: ['Uncategorized skill'] },
  ],
};

const EXPECTED = {
  cert: [
    ['Cert both', '<span class="cert-org">Issuer</span>', '<span class="cert-year">2024</span>'],
    ['Cert no org', '', '<span class="cert-year">2023</span>'],
    ['Cert no year', '<span class="cert-org">Issuer</span>', ''],
    ['Cert neither', '', ''],
  ],
  award: [
    ['Award both', '<span class="award-org">Body</span>', '<span class="award-year">2022</span>'],
    ['Award no org', '', '<span class="award-year">2021</span>'],
    ['Award no year', '<span class="award-org">Body</span>', ''],
  ],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-2486-'));

function build(label, templateArg) {
  const input = join(dir, 'mixed.json');
  const output = join(dir, `${label}.html`);
  writeFileSync(input, JSON.stringify(PAYLOAD));

  const args = [join(ROOT, 'build-cv-html.mjs'), input, output];
  if (templateArg) args.push(templateArg);

  if (run(NODE, args) === null) {
    const f = lastRunFailure();
    fail(`${label}: build-cv-html.mjs crashed (exit ${f?.status}) - ${(f?.stderr || '').trim().split('\n').pop()}`);
    return null;
  }
  if (!existsSync(output)) {
    fail(`${label}: build-cv-html.mjs exited 0 but wrote no output file`);
    return null;
  }
  return readFileSync(output, 'utf-8');
}

function checkRows(label, html) {
  for (const [kind, rows] of Object.entries(EXPECTED)) {
    const found = [...html.matchAll(new RegExp(`<div class="${kind}-item">([\\s\\S]*?)</div>`, 'g'))]
      .map(m => m[1].replace(/\s+/g, ' ').trim());

    if (found.length !== rows.length) {
      fail(`${label} ${kind}: expected ${rows.length} rows, found ${found.length}`);
      continue;
    }

    rows.forEach(([title, org, year], i) => {
      const row = found[i];
      const expected = [`<span class="${kind}-title">${title}</span>`, org, year].filter(Boolean).join(' ');
      if (row === expected) pass(`${label} ${kind}: ${title} omits empty slots`);
      else fail(`${label} ${kind}: ${title} - expected \`${expected}\`, got \`${row}\``);
    });

    if (!html.includes(`<span class="${kind}-org"></span>`) && !html.includes(`<span class="${kind}-year"></span>`)) {
      pass(`${label} ${kind}: no empty date/issuer spans`);
    } else {
      fail(`${label} ${kind}: empty spans still render`);
    }
  }
}

function blockSuffixedTemplate() {
  const packDir = join(dir, 'pack');
  cpSync(join(ROOT, 'templates'), packDir, { recursive: true });

  for (const section of ['certifications', 'awards']) {
    const file = join(packDir, 'sections', `${section}.html`);
    const renamed = readFileSync(file, 'utf-8')
      .replaceAll('ORG_EMPTY', 'ORG_BLOCK_EMPTY')
      .replaceAll('YEAR_EMPTY', 'YEAR_BLOCK_EMPTY');
    for (const field of ['ORG', 'YEAR']) {
      if (!renamed.includes(`<!--${field}_BLOCK_EMPTY-->`)) {
        fail(`${section}.html no longer defines the ${field}_EMPTY fallback this fixture renames`);
      }
    }
    writeFileSync(file, renamed);
  }

  return join(packDir, 'cv-template.html');
}

try {
  const shipped = build('shipped', null);
  if (shipped) {
    checkRows('shipped:', shipped);

    const skillRows = [...shipped.matchAll(/<div class="skill-item">([\s\S]*?)<\/div>/g)]
      .map(m => m[1].replace(/\s+/g, ' ').trim());
    const labelled = '<span class="skill-category">Languages: </span>JavaScript';
    if (skillRows[0] === labelled) pass('skills: a category renders its label');
    else fail(`skills: expected \`${labelled}\`, got \`${skillRows[0]}\``);
    if (skillRows[1] === 'Uncategorized skill') pass('skills: no category renders no label');
    else fail(`skills: expected a bare row, got \`${skillRows[1]}\``);
  }

  const suffixed = build('block-suffixed', blockSuffixedTemplate());
  if (suffixed) checkRows('_BLOCK_EMPTY:', suffixed);
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
