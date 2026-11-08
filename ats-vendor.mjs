/**
 * Derive a stable ATS vendor label from a job or careers URL.
 *
 * Known platforms use their provider id so callers can route directly to the
 * matching scanner plugin. An otherwise-valid web URL returns its lower-cased
 * hostname instead of collapsing to "unknown": the long tail is useful signal
 * even before career-ops has a provider for it.
 */

export {
  ATS_HOST_PATTERNS,
  KNOWN_ATS_VENDORS,
  atsVendorOf,
  atsApplyPlan,
} from "./web/src/lib/apply/ats-plan.mjs";
