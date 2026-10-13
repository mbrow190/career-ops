import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { pass, fail, run, NODE, ROOT, lastRunFailure } from './helpers.mjs';

console.log('\ncv-tailor.mjs merges headline, summary, and skill order');

const { applyCvTailor } = await import(pathToFileURL(join(ROOT, 'cv-tailor.mjs')).href);

const payload = {
  candidate: { name: 'Alex Rivera', title: 'Engineer' },
  summary: 'Builds APIs.',
  skills: [
    { category: 'Cloud', items: ['AWS', 'GCP'] },
    { category: 'Languages', items: ['Python', 'Go'] },
  ],
};

const tailored = applyCvTailor(payload, {
  headline: 'Senior Backend Engineer',
  summary: 'Builds APIs in Python.',
  skill_order: ['Languages', 'Python'],
});

if (tailored.candidate.title === 'Senior Backend Engineer') pass('sets headline');
else fail(`headline: ${tailored.candidate.title}`);
if (tailored.summary === 'Builds APIs in Python.') pass('sets summary');
else fail(`summary: ${tailored.summary}`);
if (tailored.skills[0].category === 'Languages' && tailored.skills[0].items[0] === 'Python') pass('reorders existing skills');
else fail(`skills: ${JSON.stringify(tailored.skills)}`);
if (payload.candidate.title === 'Engineer') pass('does not mutate the input');
else fail('input was mutated');

try {
  applyCvTailor(payload, { skill_order: ['Rust'] });
  fail('invented skill was accepted');
} catch (err) {
  if (/Rust/.test(err.message)) pass('rejects a skill that is not in the payload');
  else fail(err.message);
}

const dir = mkdtempSync(join(tmpdir(), 'cv-tailor-cli-'));
try {
  const input = join(dir, 'cv.json');
  writeFileSync(input, JSON.stringify(payload, null, 2));
  if (run(NODE, [join(ROOT, 'cv-tailor.mjs'), input, '--headline=Staff Engineer', '--skill-order=Cloud']) === null) {
    fail(`cli failed: ${(lastRunFailure()?.stderr || '').trim()}`);
  } else {
    const saved = JSON.parse(readFileSync(input, 'utf-8'));
    if (saved.candidate.title === 'Staff Engineer' && saved.skills[0].category === 'Cloud') pass('cli writes the tailored payload');
    else fail(`cli output: ${JSON.stringify(saved.candidate)}`);
  }
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
