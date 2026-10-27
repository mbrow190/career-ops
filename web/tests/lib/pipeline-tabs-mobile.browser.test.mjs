// Optional browser regression: use the disposable fixture created by
// node tests/fixtures/pipeline-status.mjs as CAREER_OPS_ROOT for a local server.
// Set PIPELINE_TABS_TEST_URL and PIPELINE_TABS_TEST_ROOT to run this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PIPELINE_TABS } from "../../src/lib/pipeline-navigation.mjs";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.PIPELINE_TABS_TEST_URL;
const root = process.env.PIPELINE_TABS_TEST_ROOT;

test("Pipeline status tabs stay on one scrollable row on a phone", { skip: liveServerSkip("PIPELINE_TABS_TEST_URL", "PIPELINE_TABS_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tabButton = (name) => page.getByRole("button", { name: new RegExp(`^${name} \\d+$`) });
  const tabs = PIPELINE_TABS.map(tabButton);
  const strip = tabs[0].locator("xpath=..");
  const inside = (inner, outer) =>
    inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5;

  await page.goto(`${origin.origin}/pipeline?tab=DISCARDED`);
  const discarded = page.getByRole("button", { name: /^DISCARDED \d+$/, pressed: true });
  await discarded.waitFor();
  const deadline = Date.now() + 5_000; // the strip scrolls after hydration
  while (!inside(await discarded.boundingBox(), await strip.boundingBox()) && Date.now() < deadline) {
    await page.waitForTimeout(100);
  }

  const boxes = await Promise.all(tabs.map((tab) => tab.boundingBox()));
  const stripBox = await strip.boundingBox();
  assert.equal(new Set(boxes.map((b) => Math.round(b.y))).size, 1, "all status tabs share one row");
  assert.ok(stripBox.height <= boxes[0].height + 4, `strip is one tab tall (${stripBox.height}px vs ${boxes[0].height}px)`);
  assert.ok(inside(await discarded.boundingBox(), stripBox), "the active DISCARDED tab is scrolled into view");
  const page390 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    scrollY: window.scrollY,
  }));
  assert.ok(page390.scrollWidth <= page390.innerWidth, `page does not scroll sideways (${page390.scrollWidth} > ${page390.innerWidth})`);
  assert.equal(page390.scrollY, 0, "the page did not scroll vertically");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  await page.getByRole("button", { name: /^ALL \d+$/, pressed: true }).waitFor();
  const wideStrip = await strip.boundingBox();
  for (const [i, tab] of tabs.entries()) {
    assert.ok(inside(await tab.boundingBox(), wideStrip), `${PIPELINE_TABS[i]} is fully visible at 1280px`);
  }
  assert.equal(await strip.evaluate((el) => el.scrollLeft), 0, "the strip is not scrolled at 1280px");
  assert.deepEqual(errors, []);
});

test("Changing the status tab on a phone scrolls only the tab strip, not the page", { skip: liveServerSkip("PIPELINE_TABS_TEST_URL", "PIPELINE_TABS_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const inside = (inner, outer) =>
    inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5;

  await page.goto(`${origin.origin}/pipeline?tab=DISCARDED`);
  const discarded = page.getByRole("button", { name: /^DISCARDED \d+$/, pressed: true });
  const all = page.getByRole("button", { name: /^ALL \d+$/ });
  const strip = all.locator("xpath=..");
  const deadline = Date.now() + 5_000; // the strip scrolls after hydration
  while (!inside(await discarded.boundingBox(), await strip.boundingBox()) && Date.now() < deadline) {
    await page.waitForTimeout(100);
  }
  assert.ok(!inside(await all.boundingBox(), await strip.boundingBox()), "ALL starts outside the strip");

  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.id = "tall-filler";
    filler.style.height = "3000px";
    document.querySelector("main").append(filler);
    window.scrollTo(0, 1500);
  });
  const fillerTop = () => page.evaluate(() => document.getElementById("tall-filler").getBoundingClientRect().top);
  const before = await fillerTop();
  const stripBox = await strip.boundingBox();
  assert.ok(stripBox.y + stripBox.height < 0, "the strip is scrolled out of view above the viewport");

  await all.evaluate((el) => el.click());
  await page.waitForURL(/tab=ALL/);
  await page.getByRole("button", { name: /^ALL \d+$/, pressed: true }).waitFor();
  const settle = Date.now() + 5_000;
  while (!inside(await all.boundingBox(), await strip.boundingBox()) && Date.now() < settle) {
    await page.waitForTimeout(100);
  }

  assert.equal(await fillerTop(), before, "the content on screen did not move");
  assert.ok(inside(await all.boundingBox(), await strip.boundingBox()), "ALL is scrolled into view in the strip");
  assert.deepEqual(errors, []);
});
