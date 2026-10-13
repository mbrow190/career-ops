import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nupload copy naming and workspace dest');

const {
  formatUploadFilename,
  resolveUploadDest,
  writeUploadCopy,
  readUploadProfile,
  isWorkspaceOutputPath,
} = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);

const cases = [
  [formatUploadFilename('{{First}}-{{Last}}-Resume.pdf', 'Alex Rivera') === 'Alex-Rivera-Resume.pdf', 'default First-Last-Resume'],
  [formatUploadFilename('{{Name}}-Resume.pdf', 'Alex Rivera') === 'Alex-Rivera-Resume.pdf', 'Name token'],
  [!/ats/i.test(formatUploadFilename(undefined, 'Alex Rivera')), 'default has no ats slug'],
  [formatUploadFilename('{{First}}-{{Last}}-Resume.pdf', '') === 'Resume.pdf', 'empty name falls back'],
  [!formatUploadFilename('../{{First}}.pdf', 'Alex Rivera').includes('..'), 'path separators stripped'],
];

for (const [ok, name] of cases) {
  if (ok) pass(name);
  else fail(name);
}

const dir = mkdtempSync(join(tmpdir(), 'upload-copy-'));
mkdirSync(join(dir, 'output'), { recursive: true });
writeFileSync(join(dir, 'config-profile.yml'), 'candidate:\n  full_name: "Alex Rivera"\ncv:\n  upload_filename: "{{First}}-{{Last}}-Resume.pdf"\n  upload_dir: output/upload\n');
const profile = readUploadProfile(join(dir, 'config-profile.yml'));
if (profile.fullName === 'Alex Rivera') pass('reads full_name from profile');
else fail(`full_name: ${profile.fullName}`);
if (profile.filenameTemplate.includes('Resume.pdf')) pass('reads upload_filename from profile');
else fail(`template: ${profile.filenameTemplate}`);

const dest = resolveUploadDest(dir, { fullName: 'Alex Rivera' });
if (dest.endsWith('output/upload/Alex-Rivera-Resume.pdf')) pass('default dest is output/upload');
else fail(`dest: ${dest}`);
if (isWorkspaceOutputPath(dest, dir)) pass('default dest stays in workspace');
else fail('default dest escaped workspace');

const internal = join(dir, 'output', 'cv-alex-rivera-acme-ats.pdf');
writeFileSync(internal, '%PDF-fake');
const copied = writeUploadCopy(internal, dir, { fullName: 'Alex Rivera' });
if (existsSync(copied) && readFileSync(copied, 'utf-8') === '%PDF-fake') pass('writes the employer copy');
else fail('employer copy missing');
if (existsSync(internal)) pass('keeps the internal file');
else fail('internal file was removed');

try {
  writeUploadCopy(internal, dir, { uploadDir: '/tmp/outside-career-ops', fullName: 'Alex Rivera' });
  fail('outside dest was accepted');
} catch (err) {
  if (/workspace/.test(err.message)) pass('refuses dest outside the workspace');
  else fail(err.message);
}
