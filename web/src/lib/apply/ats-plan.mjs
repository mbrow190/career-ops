/**
 * The Apply button imports this file because the Next bundle root is web/.
 */

const hostIs = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);

/** @typedef {"reader" | "handoff"} AtsFill */

/** @type {Array<{ id: string, label: string, fill: AtsFill, refuse?: boolean, test: (host: string) => boolean }>} */
export const ATS_HOST_PATTERNS = [
  { id: "greenhouse", label: "Greenhouse", fill: "reader", test: (h) => hostIs(h, "greenhouse.io") },
  { id: "lever", label: "Lever", fill: "reader", test: (h) => hostIs(h, "lever.co") },
  { id: "ashby", label: "Ashby", fill: "reader", test: (h) => hostIs(h, "ashbyhq.com") },
  { id: "workday", label: "Workday", fill: "handoff", refuse: true, test: (h) => hostIs(h, "myworkdayjobs.com") || hostIs(h, "myworkdaysite.com") },
  { id: "icims", label: "iCIMS", fill: "handoff", refuse: true, test: (h) => hostIs(h, "icims.com") },
  { id: "successfactors", label: "SuccessFactors", fill: "handoff", test: (h) => hostIs(h, "successfactors.com") || hostIs(h, "successfactors.eu") || hostIs(h, "jobs2web.com") },
  { id: "dayforce", label: "Dayforce", fill: "handoff", test: (h) => hostIs(h, "dayforcehcm.com") },
  { id: "ultipro", label: "UKG", fill: "handoff", refuse: true, test: (h) => hostIs(h, "ultipro.com") || hostIs(h, "ultipro.ca") },
  { id: "taleo", label: "Taleo", fill: "handoff", test: (h) => hostIs(h, "taleo.net") },
  { id: "bamboohr", label: "BambooHR", fill: "handoff", test: (h) => hostIs(h, "bamboohr.com") },
  { id: "hibob", label: "HiBob", fill: "handoff", test: (h) => hostIs(h, "careers.hibob.com") },
  { id: "smartrecruiters", label: "SmartRecruiters", fill: "handoff", test: (h) => hostIs(h, "smartrecruiters.com") },
  { id: "csod", label: "Cornerstone", fill: "handoff", test: (h) => hostIs(h, "csod.com") },
  { id: "hirehive", label: "HireHive", fill: "handoff", test: (h) => hostIs(h, "hirehive.com") },
  {
    id: "oraclecloud",
    label: "Oracle Cloud",
    fill: "handoff",
    test: (h) => /(^|\.)oraclecloud(?:[1-9]|[1-9]\d)?\.com$/.test(h),
  },
];

export const KNOWN_ATS_VENDORS = Object.freeze(ATS_HOST_PATTERNS.map(({ id }) => id));

const WORKABLE_HOST = "apply.workable.com";

/**
 * @param {unknown} rawUrl
 * @returns {URL | null}
 */
function httpUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.hostname) return null;
  return parsed;
}

/**
 * @param {unknown} rawUrl
 * @returns {string | null} provider id for a known ATS, hostname for the long
 *   tail, or null when the value is not an HTTP(S) URL.
 */
export function atsVendorOf(rawUrl) {
  const parsed = httpUrl(rawUrl);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  return ATS_HOST_PATTERNS.find(({ test }) => test(host))?.id ?? host;
}

/**
 * @param {unknown} rawUrl
 * @returns {{ id: string, label: string, fill: AtsFill, refuse: boolean, postingUrl: string } | null}
 */
export function atsApplyPlan(rawUrl) {
  const parsed = httpUrl(rawUrl);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === WORKABLE_HOST) {
    return { id: "workable", label: "Workable", fill: "reader", refuse: false, postingUrl: parsed.href };
  }
  const row = ATS_HOST_PATTERNS.find(({ test }) => test(host));
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    fill: row.fill,
    refuse: row.refuse === true,
    postingUrl: parsed.href,
  };
}

/** @param {string} label */
export function handoffChecklistMessage(label) {
  return `This posting is on ${label}. Open the posting, take the CV, copy the answers, and mark Applied after you submit.`;
}

/**
 * @param {unknown} rawUrl
 * @returns {{ label: string, message: string, postingUrl: string } | null}
 */
export function checklistHandoff(rawUrl) {
  const plan = atsApplyPlan(rawUrl);
  if (!plan || plan.fill !== "handoff") return null;
  return {
    label: plan.label,
    message: handoffChecklistMessage(plan.label),
    postingUrl: plan.postingUrl,
  };
}
