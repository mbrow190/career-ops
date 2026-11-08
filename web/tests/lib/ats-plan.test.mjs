import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { atsApplyPlan, atsVendorOf, checklistHandoff } from "../../src/lib/apply/ats-plan.mjs";
import { unsupportedInAppAts } from "../../src/lib/apply/unsupported-ats.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const handoff = [
  ["https://acme.taleo.net/careersection/jobdetail.ftl", "taleo", "Taleo", false],
  ["https://acme.successfactors.com/sfcareer/jobreqcareer?jobId=1", "successfactors", "SuccessFactors", false],
  ["https://jobs.smartrecruiters.com/Acme/1", "smartrecruiters", "SmartRecruiters", false],
  ["https://jobs.dayforcehcm.com/en-US/acme/jobs/1", "dayforce", "Dayforce", false],
  ["https://acme.bamboohr.com/careers/1", "bamboohr", "BambooHR", false],
  ["https://fa-acme.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1", "oraclecloud", "Oracle Cloud", false],
  ["https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role", "workday", "Workday", true],
  ["https://tenant.wd1.myworkdaysite.com/site", "workday", "Workday", true],
  ["https://careers-acme.icims.com/jobs/1", "icims", "iCIMS", true],
  ["https://acme.ultipro.com/jobs/1", "ultipro", "UKG", true],
  ["https://acme.ultipro.ca/jobs/1", "ultipro", "UKG", true],
  ["https://acme.csod.com/ux/ats/careersite/1", "csod", "Cornerstone", false],
  ["https://acme.hirehive.com/backend-engineer", "hirehive", "HireHive", false],
  ["https://acme.careers.hibob.com/jobs/1", "hibob", "HiBob", false],
];

test("unfilled known hosts hand off, and only Workday, iCIMS, and UKG refuse Chrome", () => {
  for (const [url, id, label, refuse] of handoff) {
    const plan = atsApplyPlan(url);
    assert.ok(plan, url);
    assert.equal(plan.id, id, url);
    assert.equal(plan.label, label, url);
    assert.equal(plan.fill, "handoff", url);
    assert.equal(plan.refuse, refuse, url);
    const named = checklistHandoff(url);
    assert.equal(named?.label, label, url);
    assert.match(named?.message ?? "", new RegExp(label));
    assert.match(named?.message ?? "", /Open the posting/);
    assert.match(named?.message ?? "", /mark Applied/);
  }
});

test("Greenhouse, Lever, Ashby, and apply.workable.com stay on the form reader", () => {
  const reader = [
    ["https://boards.greenhouse.io/acme/jobs/123", "greenhouse", "Greenhouse"],
    ["https://jobs.lever.co/acme/role", "lever", "Lever"],
    ["https://jobs.ashbyhq.com/acme/role", "ashby", "Ashby"],
    ["https://apply.workable.com/acme/j/ABC123", "workable", "Workable"],
  ];
  for (const [url, id, label] of reader) {
    const plan = atsApplyPlan(url);
    assert.ok(plan, url);
    assert.equal(plan.id, id, url);
    assert.equal(plan.label, label, url);
    assert.equal(plan.fill, "reader", url);
    assert.equal(plan.refuse, false, url);
    assert.equal(checklistHandoff(url), null, url);
  }
});

test("Workable detection does not change the scanner vendor id", () => {
  assert.equal(atsVendorOf("https://apply.workable.com/acme/j/ABC123"), "apply.workable.com");
  assert.equal(atsApplyPlan("https://www.workable.com/acme"), null);
  assert.equal(atsApplyPlan("https://jobs.workable.com/acme"), null);
  assert.equal(atsApplyPlan("https://apply.workable.com.evil.example/acme"), null);
});

test("a company careers host and a lookalike host are not a known ATS", () => {
  assert.equal(atsApplyPlan("https://careers.example.com/jobs/1"), null);
  assert.equal(atsApplyPlan("https://notmyworkdayjobs.com/role"), null);
  assert.equal(atsApplyPlan("https://hibob.com/careers"), null);
  assert.equal(checklistHandoff("https://careers.example.com/jobs/1"), null);
});

test("the session refusal uses the same vendor label as the Apply plan", async () => {
  const url = "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role";
  const plan = atsApplyPlan(url);
  const hit = await unsupportedInAppAts(url);
  assert.equal(hit?.vendor, plan?.id);
  assert.equal(hit?.label, plan?.label);
  assert.equal(hit?.label, "Workday");
  assert.equal(await unsupportedInAppAts("https://acme.taleo.net/careersection/jobdetail.ftl"), null);
  assert.equal(await unsupportedInAppAts("https://boards.greenhouse.io/acme/jobs/123"), null);
  assert.equal(await unsupportedInAppAts("https://apply.workable.com/acme/j/ABC123"), null);
});

test("the checklist offers the form reader, and the Apply button does not keep its own title", () => {
  const checklist = readFileSync(join(here, "../../src/components/apply-checklist.tsx"), "utf8");
  const button = readFileSync(join(here, "../../src/components/apply-button.tsx"), "utf8");
  const page = readFileSync(join(here, "../../src/app/pipeline/[id]/apply/page.tsx"), "utf8");
  assert.match(checklist, /Try the form reader anyway/);
  assert.match(button, /applyButtonTitle\(dest/);
  assert.doesNotMatch(button, /Opens the form pre-filled/);
  assert.match(page, /checklistHandoff\(postingUrl\)/);
  assert.match(button, /dest\.kind === "handoff"/);
});
