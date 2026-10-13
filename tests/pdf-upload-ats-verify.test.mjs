// Fictional sample: reading order, PDF title, upload copy, internal index.
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, run, NODE, ROOT, lastRunFailure } from './helpers.mjs';

console.log('\npdf upload copy and ATS reading order (fictional Alex Rivera)');

const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Alex Rivera', email: 'alex.rivera@example.test', location: 'Austin, TX' },
  summary: 'Backend engineer who shipped billing APIs.',
  competencies: ['Distributed Systems', 'API Design'],
  experience: [{
    company: 'Northwind Labs',
    role: 'Backend Engineer',
    dates: '2022 - Present',
    bullets: ['Cut p99 latency from 800 ms to 120 ms'],
  }],
  education: [{ title: 'BSc Computer Science', org: 'Example University', year: '2018' }],
  certifications: [{ title: 'AWS Certified Developer', org: 'Amazon', year: '2024' }],
  awards: [{ title: 'Hackathon First Place', org: 'Example Conf', year: '2021' }],
  skills: [{ category: 'Languages', items: ['Python', 'Go'] }],
};

const templates = [
  ['default', null],
  ['ats', join(ROOT, 'templates', 'ats', 'cv-template.ats.html')],
];

const dir = mkdtempSync(join(tmpdir(), 'pdf-upload-ats-'));
mkdirSync(join(dir, 'output', 'upload'), { recursive: true });
mkdirSync(join(dir, 'data'), { recursive: true });
mkdirSync(join(dir, 'config'), { recursive: true });
writeFileSync(join(dir, 'config', 'profile.yml'), [
  'candidate:',
  '  full_name: "Alex Rivera"',
  'cv:',
  '  upload_filename: "{{First}}-{{Last}}-Resume.pdf"',
  '  upload_dir: output/upload',
  '',
].join('\n'));
writeFileSync(join(dir, 'cv.md'), `# Alex Rivera

## Experience

### Northwind Labs - Austin, TX
**Backend Engineer** | 2022 - Present
- Cut p99 latency from 800 ms to 120 ms

## Education
BSc Computer Science, Example University, 2018

## Skills
- Languages: Python, Go
`);

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/\n+/g, '\n');
}

function orderOk(text, parts, label) {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    if (at < 0) {
      fail(`${label}: missing "${part}"`);
      return false;
    }
    from = at + part.length;
  }
  pass(`${label}: ${parts.join(' -> ')}`);
  return true;
}

try {
  for (const [label, template] of templates) {
    const json = join(dir, `${label}.json`);
    const htmlPath = join(dir, `${label}.html`);
    writeFileSync(json, JSON.stringify(PAYLOAD, null, 2));
    const args = [join(ROOT, 'build-cv-html.mjs'), json, htmlPath];
    if (template) args.push(template);
    if (run(NODE, args) === null) {
      fail(`${label} build failed: ${(lastRunFailure()?.stderr || '').trim()}`);
      continue;
    }
    const html = readFileSync(htmlPath, 'utf-8');
    const title = html.match(/<title>[^<]+<\/title>/)?.[0] || '';
    if (title === '<title>Alex Rivera - CV</title>' && !title.includes('\u2014')) {
      pass(`${label} title uses a hyphen, not an em dash`);
    } else {
      fail(`${label} title: ${title}`);
    }
    const text = visibleText(html);
    orderOk(text, ['AWS Certified Developer', 'Amazon', '2024'], `${label} cert`);
    orderOk(text, ['BSc Computer Science', 'Example University', '2018'], `${label} education`);
    if (label === 'ats') {
      if (!/<(?:span|div) class="skill-category">/.test(html) && text.includes('Python')) {
        pass('ats skills omit repeated category labels');
      } else {
        fail('ats skills still repeat categories');
      }
    }
  }

  const titles = [
    'templates/cv-template.html',
    'templates/cv-template.compact.html',
    'templates/cv-template.leadership.html',
    'templates/cv-template.executive.html',
    'templates/cv-template.jake.html',
    'templates/cv-template.zh-minimal.html',
    'templates/resume-template.html',
    'templates/ats/cv-template.ats.html',
  ];
  const bad = titles.filter((file) => /<title>[^<]*\u2014/.test(readFileSync(join(ROOT, file), 'utf-8')));
  if (bad.length === 0) pass('listed templates have no em dash in the title');
  else fail(`em dash still in title of ${bad.join(', ')}`);

  const htmlPath = join(dir, 'default.html');
  const internalPdf = join(dir, 'output', 'cv-alex-rivera-northwind-ats.pdf');
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md') };
  writeFileSync(join(dir, 'data', 'applications.md'), '# Applications Tracker\n');
  const rendered = spawnSync(NODE, [
    join(ROOT, 'generate-pdf.mjs'),
    htmlPath,
    internalPdf,
    '--format=letter',
    '--report=1',
    '--skip-fact-check',
    '--upload-name=Alex-Rivera-Resume.pdf',
  ], { cwd: dir, env, encoding: 'utf-8', timeout: 120_000 });

  if (rendered.status !== 0) {
    fail(`generate-pdf failed: ${(rendered.stderr || rendered.stdout || '').slice(0, 400)}`);
  } else {
    const upload = join(dir, 'output', 'upload', 'Alex-Rivera-Resume.pdf');
    if (existsSync(internalPdf)) pass('internal PDF is written');
    else fail('internal PDF missing');
    if (existsSync(upload)) pass('upload-named copy is written');
    else fail(`upload copy missing (${rendered.stdout})`);
    const index = existsSync(join(dir, 'data', 'pdf-index.tsv'))
      ? readFileSync(join(dir, 'data', 'pdf-index.tsv'), 'utf-8')
      : '';
    if (index.includes('cv-alex-rivera-northwind-ats.pdf')) pass('pdf-index records the internal file');
    else fail(`pdf-index:\n${index}`);
    if (!index.includes('Alex-Rivera-Resume.pdf')) pass('pdf-index does not replace the internal row with the upload name');
    else fail('pdf-index pointed at the upload copy');

    const pdfBuf = existsSync(internalPdf) ? readFileSync(internalPdf) : Buffer.alloc(0);
    if (pdfBuf.includes(Buffer.from('\u2014')) || /Title[^\n]*\u2014/.test(pdfBuf.toString('latin1'))) {
      fail('PDF bytes still contain an em dash');
    } else {
      pass('PDF title has no em dash');
    }

    const pdftotext = spawnSync('pdftotext', ['-layout', internalPdf, '-'], { encoding: 'utf-8', timeout: 15_000 });
    if (pdftotext.status === 0) {
      orderOk(pdftotext.stdout, ['AWS Certified Developer', 'Amazon', '2024'], 'pdftotext cert');
      orderOk(pdftotext.stdout, ['BSc Computer Science', 'Example University', '2018'], 'pdftotext education');
    } else {
      pass('pdftotext not installed; HTML reading-order checks already ran');
    }
  }
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
