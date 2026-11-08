import { canonicalJobKey } from "./core/url-key.mjs";

/** Cards the home dashboard renders when no explicit limit is asked for. */
export const DEFAULT_OFFER_LIMIT = 24;

/**
 * Ceiling for a caller-requested limit, and what Explore's "See all" hand-off
 * asks for. The payload stays bounded on purpose: explorer-view renders every
 * offer it receives (no virtualisation, no pagination), and a default
 * portals.yml — ~120 companies against a catch-all title_filter — can leave
 * thousands of un-evaluated rows inside a 7-day window. `count` is complete
 * regardless, so the UI shows an honest total without an unbounded render.
 */
export const MAX_OFFER_LIMIT = 200;

/**
 * Resolve the `?limit=` query value into a finite render ceiling. Anything
 * missing, malformed or out of range degrades to a bounded default rather than
 * to an unbounded list.
 *
 * The whole trimmed value has to be an integer — `Number`, not `parseInt`,
 * because parseInt accepts a numeric *prefix*: it would read "24junk" as 24 and
 * "1e9" as 1, letting a malformed limit silently under-fetch instead of falling
 * back. `Number.isInteger` also rejects Infinity, so the unbounded sentinel
 * cannot slip back in through the query string.
 */
export function resolveOfferLimit(raw) {
  if (raw == null) return DEFAULT_OFFER_LIMIT;
  const text = String(raw).trim();
  if (text === "") return DEFAULT_OFFER_LIMIT;
  const requested = Number(text);
  if (!Number.isInteger(requested)) return DEFAULT_OFFER_LIMIT;
  return Math.min(MAX_OFFER_LIMIT, Math.max(1, requested));
}

/**
 * A scan-history status that says the POSTING is gone, not merely that this row
 * is not a fresh match. Matches `skipped_expired` (what the scanner and
 * check-liveness write) and the legacy `added (expired)` suffix.
 *
 * Deliberately narrower than the route's own row filter: `skipped_dup` and
 * `skipped_title` mean "this row is a duplicate / off-target", and retiring a
 * URL on those would hide live postings — the exact failure this feed exists to
 * avoid.
 */
const EXPIRED_STATUS = /expired/i;

function postingKey(url) {
  if (typeof url !== "string" || !url) return "";
  return canonicalJobKey(url) || url;
}

/**
 * Posting keys that have an `added` row later in the file than an expired row.
 *
 * @param {string[]} rows
 * @returns {Set<string>}
 */
function relistedKeys(rows) {
  const newestAdded = new Map();
  const newestExpired = new Map();
  for (let i = 1; i < rows.length; i++) {
    const columns = rows[i].split("\t");
    const key = postingKey(columns[0]);
    if (!key) continue;
    const status = columns[5] || "";
    if (EXPIRED_STATUS.test(status)) newestExpired.set(key, i);
    else if (status.toLowerCase() === "added") newestAdded.set(key, i);
  }
  const relisted = new Set();
  for (const [key, at] of newestAdded) {
    const expiredAt = newestExpired.get(key);
    if (expiredAt != null && at > expiredAt) relisted.add(key);
  }
  return relisted;
}

/**
 * Collect fresh, unique offers while keeping the response payload bounded.
 * `count` always represents the full result set; `offers` is only the slice the
 * caller asked to render. This prevents a UI card limit from masquerading as
 * the number of matches found.
 *
 * `checkedKeys` are canonical keys of pipeline rows the user marked done.
 * Those stay out unless a newer `added` row already beat an expired row for
 * the same key.
 *
 * @param {string[]} rows
 * @param {{ cutoff: number, toOffer: (columns: string[]) => object | null, offerLimit?: number, fallbackLimit?: number, checkedKeys?: Set<string> | string[] }} options
 */
export function collectWhatsNew(rows, { cutoff, toOffer, offerLimit = DEFAULT_OFFER_LIMIT, fallbackLimit = 12, checkedKeys = null }) {
  const checked = checkedKeys instanceof Set ? checkedKeys : new Set(checkedKeys || []);
  const relisted = checked.size > 0 ? relistedKeys(rows) : new Set();
  const retired = new Set();
  const seenUrls = new Set();
  const offers = [];
  let count = 0;
  let anyDated = false;

  const add = (columns, limit) => {
    // A confirmed-dead row retires the posting for the rest of the walk
    // (#3891). The key is canonicalJobKey, not the exact URL string: inbox
    // Skip writes `skipped_expired`, and the other spelling of that posting
    // has to stay out too. The walk is newest-first, so a later `added` row
    // for the same key is counted before the older death certificate.
    const key = postingKey(columns[0]);
    if (EXPIRED_STATUS.test(columns[5] || "")) {
      if (key) retired.add(key);
      return;
    }
    if (key && retired.has(key)) return;
    const offer = toOffer(columns);
    if (!offer || seenUrls.has(offer.url)) return;
    if (key && checked.has(key) && !relisted.has(key)) return;
    seenUrls.add(offer.url);
    count += 1;
    if (offers.length < limit) offers.push(offer);
  };

  // Recent-by-date supply loop. Walk every row so `count` is not capped by the
  // number of cards returned to the client.
  for (let i = rows.length - 1; i >= 1; i--) {
    const columns = rows[i].split("\t");
    const timestamp = Date.parse(columns[1] || "");
    if (Number.isFinite(timestamp)) anyDated = true;
    if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
    add(columns, offerLimit);
  }

  // Legacy histories may have no parseable first_seen values. Preserve the
  // append-order fallback while still returning its full unique count.
  if (count === 0 && !anyDated) {
    for (let i = rows.length - 1; i >= 1; i--) {
      add(rows[i].split("\t"), fallbackLimit);
    }
  }

  return { offers, count };
}
