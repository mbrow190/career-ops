import { atsApplyPlan } from "./ats-plan.mjs";
import { checklistHrefFor } from "./checklist-href.mjs";

export { checklistHrefFor };

/**
 * @param {string} label
 * @param {boolean} [opened] True when a window was opened and then closed.
 */
export function unsupportedAtsMessage(label, opened = false) {
  const lead = `This posting is on ${label}. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app`;
  return opened ? `${lead}. The window was closed.` : `${lead}, so no browser was opened.`;
}

/**
 * @param {unknown} url
 * @returns {Promise<{ vendor: string, label: string, postingUrl: string } | null>}
 */
export async function unsupportedInAppAts(url) {
  const plan = atsApplyPlan(url);
  if (!plan?.refuse) return null;
  return { vendor: plan.id, label: plan.label, postingUrl: plan.postingUrl };
}

/**
 * HTTP body for a refusal. checklistHref is present only for a numeric application id.
 *
 * @param {{ vendor: string, label: string, postingUrl: string }} hit
 * @param {unknown} applicationNumber
 * @param {boolean} [opened] True when a window was opened and then closed.
 */
export function unsupportedSessionJson(hit, applicationNumber, opened = false) {
  /** @type {{ unsupported: true, vendor: string, label: string, postingUrl: string, message: string, checklistHref?: string }} */
  const body = {
    unsupported: true,
    vendor: hit.vendor,
    label: hit.label,
    postingUrl: hit.postingUrl,
    message: unsupportedAtsMessage(hit.label, opened),
  };
  const checklistHref = checklistHrefFor(applicationNumber);
  if (checklistHref) body.checklistHref = checklistHref;
  return body;
}
