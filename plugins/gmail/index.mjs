// @ts-check
// ── Reference seed ── This bundled plugin is a stable, reviewed example. To
// extend it, publish career-ops-plugin-<id> with "supersedesBundled": true and
// your version takes precedence once installed (see docs/PLUGINS.md). Bundled
// seeds take only security/compat fixes — feature work happens in the successor repo.
//
// Gmail ingest plugin — pulls job leads from a Gmail label into your pipeline.
//
// Ported from the email-driven ingestion contributed by @SparshGarg999 in #1203
// (with thanks), reshaped to the plugin contract: OAuth credentials come from
// the scoped ctx.env (not credential files), the label/days_back come from
// ctx.settings (config/plugins.yml), and the hook RETURNS Job[] — the engine
// (plugins.mjs), not this plugin, writes them to pipeline.md canonically. No
// `search://` rows are emitted (they aren't real URLs the pipeline can open).
//
// Enable in config/plugins.yml:
//   gmail: { enabled: true, label: "Job Leads", days_back: 7 }
// Add to .env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.
// Run:  node plugins.mjs run gmail

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { normalizeUrl } from '../../url-key.mjs';
import {
  extractUrls, isCleanUrl, isAuthenticEmail, parseRoleAtCompany,
  getMessageBody, companyFromUrl,
} from './_helpers.mjs';

export const EMAIL_LEAD_TITLE = 'Job lead (email)';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const STATE_FILE = join('data', 'gmail-state.json'); // the plugin's own processed-id cursor

// The cursor is user-layer data, so it lives under the data root (ctx.dataRoot)
// like the pipeline the engine writes these leads to. A ctx that carries no
// dataRoot comes from an engine older than the capability, and keeps the
// working directory that engine's plugins used.
const statePath = (ctx) => join(ctx?.dataRoot || process.cwd(), STATE_FILE);
// Where the cursor was kept before: relative to the working directory, which is
// the data root only when the two happen to coincide.
const legacyStatePath = () => resolve(STATE_FILE);

/** Exchange the long-lived refresh token for a short-lived access token. */
async function getAccessToken({ clientId, clientSecret, refreshToken }, fetchFn = globalThis.fetch) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('Gmail token refresh returned no access_token');
  return data.access_token;
}

function loadProcessedIds(ctx) {
  let path = statePath(ctx);
  let fromLegacy = false;
  if (!existsSync(path)) {
    // No cursor under the data root yet. Read the one an earlier version left
    // in the working directory, so the first run after the move does not
    // re-ingest every message it had already processed. The next save writes
    // the data-root file, and from then on this branch is never taken. The old
    // file is left where it is.
    const legacy = legacyStatePath();
    if (!existsSync(legacy)) return { ids: new Set(), fromLegacy: false };
    ctx.log(`gmail: using the processed-id cursor at ${legacy}; the next save writes it to ${path}`);
    path = legacy;
    fromLegacy = true;
  }
  try {
    const state = JSON.parse(readFileSync(path, 'utf-8'));
    return { ids: new Set(state.processed_message_ids || []), fromLegacy };
  } catch {
    return { ids: new Set(), fromLegacy };
  }
}

function saveProcessedIds(ids, ctx) {
  try {
    const path = statePath(ctx);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ processed_message_ids: [...ids] }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`gmail: could not persist processed-id state — ${err.message}`);
  }
}

/**
 * @param {Array<{ messageIds?: string[] }>} admitted
 * @param {{ seen?: Array<{ messageIds?: string[] }>, title?: Array<{ messageIds?: string[] }>, location?: Array<{ messageIds?: string[] }>, blacklisted?: Array<{ messageIds?: string[] }> }} [skipped]
 * @returns {string[]}
 */
export function messageIdsReadyToCommit(admitted, skipped) {
  const blocked = new Set();
  const order = [];
  const seen = new Set();
  const touch = (jobs, block) => {
    for (const job of jobs || []) {
      for (const id of job?.messageIds || []) {
        if (typeof id !== 'string' || !id) continue;
        if (!seen.has(id)) {
          seen.add(id);
          order.push(id);
        }
        if (block) blocked.add(id);
      }
    }
  };
  touch(admitted, false);
  touch(skipped?.seen, false);
  touch(skipped?.title, true);
  touch(skipped?.location, true);
  touch(skipped?.blacklisted, true);
  return order.filter((id) => !blocked.has(id));
}

export function commitProcessedMessages(ctx, ids) {
  if (ctx?.dryRun || !ids?.length) return;
  const processed = loadProcessedIds(ctx).ids;
  let changed = false;
  for (const id of ids) {
    if (typeof id !== 'string' || !id || processed.has(id)) continue;
    processed.add(id);
    changed = true;
  }
  if (changed) saveProcessedIds(processed, ctx);
}

/**
 * @param {{ title?: Array<{ title?: string }> }} [skipped]
 * @returns {string}
 */
export function placeholderSkipNote(skipped) {
  const n = (skipped?.title || []).filter((job) => job?.title === EMAIL_LEAD_TITLE).length;
  if (!n) return '';
  const lead = n === 1 ? 'lead' : 'leads';
  const stay = n === 1 ? 'stays' : 'stay';
  return `${n} ${lead} titled "${EMAIL_LEAD_TITLE}" missed the title filter and ${stay} unread`;
}

export function gmailSkipDetail(countsText, skipped) {
  return [countsText, placeholderSkipNote(skipped)].filter(Boolean).join('; ');
}

/** @type {{ ingest: (ctx: any) => Promise<object[]> }} */
export default {
  async ingest(ctx) {
    const clientId = ctx?.env?.GMAIL_CLIENT_ID;
    const clientSecret = ctx?.env?.GMAIL_CLIENT_SECRET;
    const refreshToken = ctx?.env?.GMAIL_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('gmail: missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN in .env');
    }

    const label = ctx?.settings?.label || 'Job Leads';
    const daysBack = Number(ctx?.settings?.days_back ?? 7);
    if (!Number.isInteger(daysBack) || daysBack <= 0) {
      throw new Error(`gmail: invalid days_back "${ctx?.settings?.days_back}" (must be a positive integer)`);
    }

    const token = await getAccessToken({ clientId, clientSecret, refreshToken }, ctx.fetch);
    const auth = { Authorization: `Bearer ${token}` };
    const query = `label:"${label}" newer_than:${daysBack}d`;
    ctx.log(`gmail: querying ${query}`);

    // List message ids (paginated). ctx.fetch throws on a non-2xx (with the body
    // in the message), so a failed page surfaces a clear error.
    const messages = [];
    let pageToken = null;
    do {
      let url = `${GMAIL_API}/messages?q=${encodeURIComponent(query)}`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      const data = await (await ctx.fetch(url, { headers: auth })).json();
      if (data.messages) messages.push(...data.messages);
      pageToken = data.nextPageToken;
    } while (pageToken);

    const loaded = loadProcessedIds(ctx);
    const processedIds = loaded.ids;
    const commitNow = [];
    const jobs = [];

    for (const m of messages) {
      if (processedIds.has(m.id)) continue;
      // Per-message resilience: a single bad detail fetch is skipped, not fatal.
      let msg;
      try {
        msg = await (await ctx.fetch(`${GMAIL_API}/messages/${m.id}?format=full`, { headers: auth })).json();
      } catch (err) {
        console.warn(`gmail: failed to fetch message ${m.id} — ${err.message}`);
        continue;
      }
      const headers = msg.payload?.headers || [];
      const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';

      // Fail-closed on spoofed mail (DMARC).
      if (!isAuthenticEmail(headers)) {
        console.warn(`gmail: skipping spoofed/unauthenticated email "${subject}"`);
        commitNow.push(m.id);
        continue;
      }

      const seed = parseRoleAtCompany(subject);
      const cleanUrls = extractUrls(getMessageBody(msg.payload)).filter(isCleanUrl);
      const kept = [];
      for (const raw of cleanUrls) {
        const url = normalizeUrl(raw);
        if (url) kept.push(url);
      }
      if (kept.length === 0) {
        commitNow.push(m.id);
        continue;
      }
      for (const url of kept) {
        let job = jobs.find((item) => item.url === url);
        if (!job) {
          job = {
            title: seed?.role || EMAIL_LEAD_TITLE,
            url,
            company: companyFromUrl(url) || seed?.company || '',
            location: '',
            messageIds: [],
          };
          jobs.push(job);
        }
        if (!job.messageIds.includes(m.id)) job.messageIds.push(m.id);
      }
    }

    if (!ctx?.dryRun && (loaded.fromLegacy || commitNow.length)) {
      for (const id of commitNow) processedIds.add(id);
      saveProcessedIds(processedIds, ctx);
    }
    return jobs;
  },
};
