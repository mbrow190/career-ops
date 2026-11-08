import { canonicalJobKey } from "./core/url-key.mjs";
import { readTrackerUrl } from "./posting-url.mjs";

/**
 * A saved tracker row completes its inbox discovery even when the evaluator
 * did not update pipeline.md's checkbox. Use posting identity, never a title
 * or company match: sibling openings must stay available for evaluation.
 *
 * @template {{ url: string, done: boolean }} T
 * @param {T[]} inbox
 * @param {{url?: string}[]} applications
 * @returns {T[]}
 */
export function reconcileInbox(inbox, applications) {
  const tracked = new Set(applications
    .map((app) => canonicalJobKey(readTrackerUrl(app.url)))
    .filter(Boolean));
  return inbox.map((job) => {
    const key = canonicalJobKey(job.url);
    return !job.done && key && tracked.has(key) ? { ...job, done: true } : job;
  });
}

/**
 * Canonical keys of checked inbox rows. A checked spelling has to hold the
 * key, or an unchecked alias of the same posting stays pending.
 *
 * @param {{ url: string, done: boolean }[]} inbox
 * @returns {Set<string>}
 */
export function checkedInboxKeys(inbox) {
  const keys = new Set();
  for (const job of inbox) {
    if (!job?.done) continue;
    const key = canonicalJobKey(job.url) || job.url;
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Pending inbox postings, deduped by canonical posting key (pipeline.md can
 * list the same posting twice), so the header count, the tab count and the
 * triage list agree on one number. A checked row dismisses every spelling,
 * including an unchecked alias listed earlier.
 *
 * @template {{ url: string, done: boolean }} T
 * @param {T[]} inbox
 * @returns {T[]}
 */
export function pendingInbox(inbox) {
  const dismissed = checkedInboxKeys(inbox);
  const seen = new Set();
  const out = [];
  for (const j of inbox) {
    const key = canonicalJobKey(j.url) || j.url;
    if (j.done || dismissed.has(key) || seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(j);
  }
  return out;
}
