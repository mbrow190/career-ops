// A LinkedIn job-alert link carries trackingId in the query. The Gmail plugin
// used to treat that as a click tracker, drop the only URL, and still store the
// message id. The next run then reported nothing and never read the mail again.
// A title the user's keyword list rejects must leave the same id unstored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCleanUrl } from '../../plugins/gmail/_helpers.mjs';
import gmail from '../../plugins/gmail/index.mjs';
import { buildTitleFilter } from '../../title-keywords.mjs';
import { normalizeUrl } from '../../url-key.mjs';

async function cursorApi() {
  return import('../../plugins/gmail/index.mjs');
}

const LINKEDIN = 'https://www.linkedin.com/comm/jobs/view/4100000001/?trackingId=abc&refId=x1&trk=eml-email_job_alert';
const GREENHOUSE = 'https://boards.greenhouse.io/hooli/jobs/7700001?gh_src=abc';
const CLICK = 'https://u123.ct.sendgrid.net/ls/click?upn=abc';
const PLACEHOLDER = 'Job lead (email)';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

function mailbox(messages, { dryRun = false, dataRoot }) {
  const ctx = {
    dryRun,
    dataRoot,
    normalizePostingUrl: normalizeUrl,
    env: { GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y', GMAIL_REFRESH_TOKEN: 'z' },
    settings: {},
    log: () => {},
    fetch: async (url) => {
      if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'fake' }) };
      if (url.includes('messages?')) {
        return { ok: true, json: async () => ({ messages: messages.map((m) => ({ id: m.id })) }) };
      }
      const hit = messages.find((m) => url.includes(`messages/${m.id}?`));
      if (hit) return { ok: true, json: async () => hit };
      return { ok: true, json: async () => ({}) };
    },
  };
  return ctx;
}

function message(id, { subject = 'Job alert', authentic = true, body = '' } = {}) {
  const headers = [{ name: 'Subject', value: subject }];
  if (authentic) {
    headers.push({ name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=example.test' });
  }
  return {
    id,
    payload: { mimeType: 'text/plain', headers, body: { data: b64(body) } },
  };
}

function readIds(dataRoot) {
  const path = join(dataRoot, 'data', 'gmail-state.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')).processed_message_ids;
}

test('a job-board URL with a tracking query is kept, and a click-tracker host is not', () => {
  assert.equal(isCleanUrl(LINKEDIN), true);
  assert.equal(isCleanUrl('https://www.linkedin.com/jobs/view/4100000001/?trk=eml'), true);
  assert.equal(isCleanUrl(GREENHOUSE), true);
  assert.equal(isCleanUrl('https://example.com/click/track'), false);
  assert.equal(isCleanUrl(CLICK), false);
  assert.equal(isCleanUrl('http://example.com/jobs/1'), false);
  assert.equal(isCleanUrl('https://www.linkedin.com/legal/privacy-policy'), false);
});

test('a positive title list rejects the email placeholder', () => {
  const filter = buildTitleFilter({ positive: ['engineer'] });
  assert.equal(filter(PLACEHOLDER), false);
  assert.equal(filter('Staff Engineer'), true);
});

test('ingest keeps the posting, strips tracker query keys, and does not store the message id', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'gmail-cursor-'));
  try {
    const jobs = await gmail.ingest(mailbox([
      message('msg-job', { body: `Apply ${LINKEDIN}` }),
    ], { dataRoot }));
    assert.deepEqual(
      { count: jobs.length, cursor: readIds(dataRoot) },
      { count: 1, cursor: null },
    );
    assert.equal(jobs[0].title, PLACEHOLDER);
    assert.equal(jobs[0].url.includes('trackingId'), false);
    assert.equal(jobs[0].url.includes('trk='), false);
    assert.match(jobs[0].url, /linkedin\.com\/comm\/jobs\/view\/4100000001/);
    assert.deepEqual(jobs[0].messageIds, ['msg-job']);
    assert.equal(readIds(dataRoot), null);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('a message with no usable job URL is stored, including one that is only a click tracker', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'gmail-cursor-empty-'));
  try {
    const jobs = await gmail.ingest(mailbox([
      message('msg-empty', { body: 'No links today.' }),
      message('msg-click', { body: `Open ${CLICK}` }),
      message('msg-spoof', { authentic: false, body: `Apply ${GREENHOUSE}` }),
    ], { dataRoot }));
    assert.deepEqual(jobs, []);
    assert.deepEqual(readIds(dataRoot), ['msg-empty', 'msg-click', 'msg-spoof']);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('a dry run does not write the cursor for a kept posting or an empty message', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'gmail-cursor-dry-'));
  try {
    await gmail.ingest(mailbox([
      message('msg-job', { body: `Apply ${LINKEDIN}` }),
      message('msg-empty', { body: 'No links today.' }),
    ], { dataRoot, dryRun: true }));
    assert.equal(readIds(dataRoot), null);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('the cursor gains a message id only after the row is saved, and not when the title filter rejects it', async () => {
  const { commitProcessedMessages, messageIdsReadyToCommit } = await cursorApi();
  const dataRoot = mkdtempSync(join(tmpdir(), 'gmail-cursor-save-'));
  try {
    const saved = { title: 'Staff Engineer', url: GREENHOUSE, messageIds: ['msg-saved'] };
    const seen = { title: 'Staff Engineer', url: 'https://jobs.example/already', messageIds: ['msg-seen'] };
    const titled = { title: PLACEHOLDER, url: LINKEDIN, messageIds: ['msg-title', 'msg-saved'] };
    const ids = messageIdsReadyToCommit([saved], { seen: [seen], title: [titled], location: [], blacklisted: [] });
    assert.deepEqual(ids, ['msg-seen']);
    commitProcessedMessages({ dataRoot, dryRun: false }, ids);
    assert.deepEqual(readIds(dataRoot), ['msg-seen']);
    commitProcessedMessages({ dataRoot, dryRun: true }, ['msg-saved']);
    assert.deepEqual(readIds(dataRoot), ['msg-seen']);
    commitProcessedMessages({ dataRoot, dryRun: false }, ['msg-saved']);
    assert.deepEqual(readIds(dataRoot), ['msg-seen', 'msg-saved']);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('the skip line names the placeholder title the filter rejected', async () => {
  const { placeholderSkipNote } = await cursorApi();
  const note = placeholderSkipNote({ title: [{ title: PLACEHOLDER }, { title: PLACEHOLDER }, { title: 'Gardener' }] });
  assert.match(note, /Job lead \(email\)/);
  assert.match(note, /2/);
  assert.equal(placeholderSkipNote({ title: [{ title: 'Gardener' }] }), '');
  assert.equal(placeholderSkipNote({}), '');
});
