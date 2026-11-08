import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pendingInbox, checkedInboxKeys } from "../../src/lib/inbox-pending.mjs";
import { parseInbox } from "../../src/lib/pipeline-table.mjs";
import { collectWhatsNew } from "../../src/lib/whats-new.mjs";
import { setInboxSkip } from "../../src/lib/inbox-skip.mjs";
import { canonicalJobKey } from "../../src/lib/core/url-key.mjs";
import {
  inboxSkipHistoryWrite,
  recordInboxSkipHistory,
} from "../../src/lib/inbox-skip-history.mjs";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ROOT = dirname(WEB);
const BOARD = "https://boards.greenhouse.io/acme/jobs/42?utm_source=li";
const ALIAS = "https://job-boards.greenhouse.io/acme/jobs/42";
const KEEP = "https://example.com/keep";
const KEY = "greenhouse:42";

const header = "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation";

function day(offset) {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

test("undo writes a newer added row only while a death certificate is newest", () => {
  const history = [
    header,
    `${ALIAS}\t2026-08-09\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
    `${BOARD}\t2026-08-10\tgreenhouse\tStaff Engineer\tAcme\tskipped_expired\tRemote`,
  ].join("\n");
  assert.deepEqual(inboxSkipHistoryWrite(history, BOARD, true), {
    status: "skipped_expired",
    policy: null,
  });
  assert.deepEqual(inboxSkipHistoryWrite(history, ALIAS, false), {
    status: "added",
    policy: { recheckAfterDays: 0 },
  });
  const undone = `${history}\n${ALIAS}\t2026-08-11\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\n`;
  assert.equal(inboxSkipHistoryWrite(undone, BOARD, false), null);
});

test("skip dismisses every spelling, leaves the unscored row, and undo brings the posting back", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-skip-history-"));
  const pipelinePath = join(root, "data", "pipeline.md");
  const historyPath = join(root, "data", "scan-history.tsv");
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(pipelinePath, [
      "## Pending",
      `- [ ] ${ALIAS} | Acme | Staff Engineer | Remote`,
      `- [ ] ${BOARD} | Acme | Staff Engineer | Remote`,
      `- [ ] ${KEEP} | Other | Analyst | Remote`,
      "",
    ].join("\n"));
    writeFileSync(historyPath, [
      header,
      `${ALIAS}\t${day(2)}\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
      `${BOARD}\t${day(2)}\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
      `${KEEP}\t${day(1)}\ttest\tAnalyst\tOther\tadded\tRemote`,
      "",
    ].join("\n"));

    const env = {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_DATA_DIR: "",
      CAREER_OPS_TRACKER: "",
      CAREER_OPS_PROFILE: "",
      CAREER_OPS_PIPELINE: "",
      CAREER_OPS_PORTALS: "",
      CAREER_OPS_SCAN_HISTORY: historyPath,
    };
    const fresh = () => {
      const jobs = parseInbox(readFileSync(pipelinePath, "utf8"));
      const rows = readFileSync(historyPath, "utf8").split("\n");
      const result = collectWhatsNew(rows, {
        cutoff: Date.now() - 30 * 86_400_000,
        toOffer: (columns) => (columns[0] ? { url: columns[0], title: columns[3], company: columns[4] } : null),
        checkedKeys: checkedInboxKeys(jobs),
      });
      return {
        urls: result.offers.map((offer) => offer.url),
        inbox: pendingInbox(jobs).map((job) => job.url),
      };
    };

    const skipped = await setInboxSkip(pipelinePath, BOARD, true, {
      lockModule: join(ROOT, "pipeline-lock.mjs"),
    });
    assert.equal(skipped.ok, true, skipped.error);
    const recorded = await recordInboxSkipHistory({
      root, pipelinePath, historyPath, url: BOARD, done: true, cwd: WEB, env,
    });
    assert.equal(recorded.ok, true, recorded.error);

    const after = fresh();
    assert.deepEqual(after.inbox, [KEEP]);
    assert.deepEqual(after.urls, [KEEP]);
    assert.match(readFileSync(historyPath, "utf8"), /skipped_expired/);

    const undone = await setInboxSkip(pipelinePath, BOARD, false, {
      lockModule: join(ROOT, "pipeline-lock.mjs"),
    });
    assert.equal(undone.ok, true, undone.error);
    const restored = await recordInboxSkipHistory({
      root, pipelinePath, historyPath, url: BOARD, done: false, cwd: WEB, env,
    });
    assert.equal(restored.ok, true, restored.error);
    const back = fresh();
    assert.ok(back.inbox.includes(KEEP));
    assert.ok(back.inbox.some((url) => canonicalJobKey(url) === KEY));
    assert.ok(back.urls.includes(KEEP));
    assert.ok(back.urls.some((url) => canonicalJobKey(url) === KEY));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
