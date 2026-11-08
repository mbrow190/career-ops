import { test } from "node:test";
import assert from "node:assert/strict";
import { applyButtonTitle, applyDestination, applyOpenArgs } from "../../src/lib/apply-destination.mjs";

test("Apply with a CV and a link opens the form reader for that offer", () => {
  const dest = applyDestination({
    n: "15",
    pdfOnDisk: true,
    postingUrl: "https://jobs.example.com/apply/15",
  });
  assert.equal(dest.kind, "apply");
  assert.equal(dest.href, "/apply");
  const open = applyOpenArgs({ dest, company: "Example Co", from: "/pipeline/15" });
  assert.deepEqual(open, {
    href: "/apply",
    url: "https://jobs.example.com/apply/15",
    opts: { prefill: true, company: "Example Co", n: "15", from: "/pipeline/15" },
  });
});

test("Apply without a tailored CV names the missing file and the report", () => {
  const dest = applyDestination({ n: "15", pdfOnDisk: false, postingUrl: "https://jobs.example.com/apply/15" });
  assert.equal(dest.kind, "need-cv");
  assert.match(dest.message, /tailored CV/);
  assert.equal(dest.nextHref, "/pipeline/15");
  assert.match(dest.nextLabel, /generate the CV/);
  assert.equal(applyOpenArgs({ dest }), null);
});

test("Apply on the report itself points at the generate step on that page", () => {
  const dest = applyDestination({
    n: "15",
    pdfOnDisk: false,
    postingUrl: "https://jobs.example.com/apply/15",
    alreadyOnReport: true,
  });
  assert.equal(dest.kind, "need-cv");
  assert.match(dest.message, /Generate the tailored CV on this page/);
  assert.equal(dest.nextHref, null);
});

test("Apply on Taleo opens the checklist and does not promise a pre-filled form", () => {
  const dest = applyDestination({
    n: "15",
    pdfOnDisk: true,
    postingUrl: "https://acme.taleo.net/careersection/jobdetail.ftl",
  });
  assert.equal(dest.kind, "handoff");
  assert.equal(dest.href, "/pipeline/15/apply");
  assert.equal(dest.label, "Taleo");
  assert.equal(applyOpenArgs({ dest, company: "Acme" }), null);
  const title = applyButtonTitle(dest);
  assert.match(title, /Taleo/);
  assert.match(title, /checklist/);
  assert.doesNotMatch(title, /pre-filled/);
  assert.match(applyButtonTitle(dest, { quiet: true }), /Below the apply line/);
  assert.doesNotMatch(applyButtonTitle(dest, { quiet: true }), /pre-filled/);
});

test("Apply on Greenhouse, Lever, Ashby, and Workable still opens the form reader", () => {
  for (const postingUrl of [
    "https://boards.greenhouse.io/acme/jobs/123",
    "https://jobs.lever.co/acme/role",
    "https://jobs.ashbyhq.com/acme/role",
    "https://apply.workable.com/acme/j/ABC123",
  ]) {
    const dest = applyDestination({ n: "15", pdfOnDisk: true, postingUrl });
    assert.equal(dest.kind, "apply", postingUrl);
    assert.equal(dest.href, "/apply");
    assert.match(applyButtonTitle(dest), /pre-filled/);
  }
});

test("Apply on a company careers host still opens the form reader", () => {
  const dest = applyDestination({
    n: "15",
    pdfOnDisk: true,
    postingUrl: "https://careers.example.com/jobs/1",
  });
  assert.equal(dest.kind, "apply");
  assert.match(applyButtonTitle(dest), /pre-filled/);
});

test("A handoff host with no numeric offer id still opens the form reader", () => {
  const dest = applyDestination({
    n: "draft",
    pdfOnDisk: true,
    postingUrl: "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role",
  });
  assert.equal(dest.kind, "apply");
});

test("Apply with a CV but no link does not open the form reader", () => {
  const dest = applyDestination({ n: "4", pdfOnDisk: true, postingUrl: "" });
  assert.equal(dest.kind, "need-link");
  assert.match(dest.message, /no application link/);
  assert.equal(applyOpenArgs({ dest }), null);
});
