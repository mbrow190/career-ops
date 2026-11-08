import { atsApplyPlan } from "./apply/ats-plan.mjs";
import { checklistHrefFor } from "./apply/checklist-href.mjs";

const HTTP = /^https?:\/\//i;

/**
 * @typedef {{ kind: "apply", href: "/apply", url: string, n: string }} ApplyGo
 * @typedef {{ kind: "handoff", href: string, url: string, n: string, label: string, vendor: string }} ApplyHandoff
 * @typedef {{ kind: "need-cv" | "need-link", message: string, nextHref: string | null, nextLabel: string | null }} ApplyStop
 */

/**
 * @param {{ n?: string, pdfOnDisk?: boolean, postingUrl?: string, alreadyOnReport?: boolean }} [input]
 * @returns {ApplyGo | ApplyHandoff | ApplyStop}
 */
export function applyDestination({ n, pdfOnDisk = false, postingUrl, alreadyOnReport = false } = {}) {
  const id = String(n ?? "").trim();
  const reportHref = `/pipeline/${encodeURIComponent(id)}`;
  if (!pdfOnDisk) {
    if (alreadyOnReport) {
      return {
        kind: "need-cv",
        message: "Generate the tailored CV on this page before you apply. Apply opens the form reader after that file is on disk.",
        nextHref: null,
        nextLabel: null,
      };
    }
    return {
      kind: "need-cv",
      message: "This offer needs a tailored CV on disk before you can apply.",
      nextHref: reportHref,
      nextLabel: "Open the report to generate the CV",
    };
  }
  const url = typeof postingUrl === "string" ? postingUrl.trim() : "";
  if (!HTTP.test(url)) {
    return {
      kind: "need-link",
      message: "This offer has no application link, so the form reader cannot open it.",
      nextHref: alreadyOnReport ? null : reportHref,
      nextLabel: alreadyOnReport ? null : "Open the report",
    };
  }
  const plan = atsApplyPlan(url);
  const checklist = checklistHrefFor(id);
  if (plan?.fill === "handoff" && checklist) {
    return { kind: "handoff", href: checklist, url, n: id, label: plan.label, vendor: plan.id };
  }
  return { kind: "apply", href: "/apply", url, n: id };
}

/**
 * @param {ApplyGo | ApplyHandoff | ApplyStop | null | undefined} dest
 * @param {{ quiet?: boolean }} [opts]
 * @returns {string}
 */
export function applyButtonTitle(dest, { quiet = false } = {}) {
  if (dest?.kind === "handoff") {
    const handoff = `This posting is on ${dest.label}. Opens the apply checklist. You submit it yourself.`;
    return quiet ? `Below the apply line or flagged caution. ${handoff}` : handoff;
  }
  const reader = "Opens the form pre-filled. You review and submit it yourself.";
  return quiet ? `Below the apply line or flagged caution. ${reader}` : reader;
}

/**
 * @param {{ dest: ApplyGo | ApplyHandoff | ApplyStop, company?: string, from?: string }} input
 * @returns {{ href: string, url: string, opts: { prefill: true, company: string, n: string, from: string } } | null}
 */
export function applyOpenArgs({ dest, company = "", from = "" }) {
  if (!dest || dest.kind !== "apply") return null;
  return {
    href: dest.href,
    url: dest.url,
    opts: { prefill: true, company, n: dest.n, from },
  };
}
