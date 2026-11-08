/**
 * Inbox Skip writes the scan-history status What's New already retires.
 * `skipped_expired` matches collectWhatsNew's death certificate. Undo appends
 * a newer `added` row so that same newest-first walk puts the posting back.
 * Evaluating a report checks the pipeline box through setInboxSkip and does
 * not come through here, so a saved score does not get a death certificate.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJobKey } from "./core/url-key.mjs";
import { resolveCodeRoot, resolveRootScript } from "./core/code-root.mjs";
import { parseInbox } from "./pipeline-table.mjs";

export const INBOX_SKIP_HISTORY_STATUS = "skipped_expired";

function postingKey(url) {
  if (typeof url !== "string" || !url) return "";
  return canonicalJobKey(url) || url;
}

/**
 * @param {string} historyText
 * @param {string} url
 * @param {boolean} done
 * @returns {{ status: string, policy: { recheckAfterDays: number } | null } | null}
 */
export function inboxSkipHistoryWrite(historyText, url, done) {
  const key = postingKey(url);
  if (!key) return null;
  if (done) return { status: INBOX_SKIP_HISTORY_STATUS, policy: null };

  const lines = String(historyText ?? "").split(/\r?\n/);
  let newestExpired = -1;
  let newestAdded = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("url\t")) continue;
    const columns = line.split("\t");
    if (postingKey(columns[0]) !== key) continue;
    if (/expired/i.test(columns[5] || "")) newestExpired = i;
    else if ((columns[5] || "") === "added") newestAdded = i;
  }
  if (newestExpired < 0 || newestAdded > newestExpired) return null;
  return { status: "added", policy: { recheckAfterDays: 0 } };
}

/**
 * @param {string} pipelineText
 * @param {string} url
 */
export function inboxSkipHistoryOffer(pipelineText, url) {
  const jobs = parseInbox(pipelineText);
  const key = postingKey(url);
  const row = jobs.find((job) => job.url === url) || jobs.find((job) => postingKey(job.url) === key);
  return {
    url,
    company: row?.company || "",
    title: row?.role || "",
    location: row?.location || "",
    source: "inbox",
  };
}

function writerResult(stdout, stderr, exit) {
  const last = String(stdout ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "";
  if (last) {
    try {
      const parsed = JSON.parse(last);
      if (parsed && parsed.ok === true) return { ok: true, wrote: Number(parsed.wrote) || 0 };
      if (parsed && parsed.ok === false) return { ok: false, error: String(parsed.error || "history write failed") };
    } catch {
      // Fall through to the exit status.
    }
  }
  const said = String(stderr ?? "").split("\n").map((line) => line.trim()).filter((line) => line && !/^Node\.js v\d/.test(line));
  const why = said.find((line) => /^\w*Error\b/.test(line)) ?? said.at(-1);
  const how = exit?.signal ? `killed by ${exit.signal}` : exit?.code ? `exit code ${exit.code}` : "no result";
  return { ok: false, error: `history writer failed (${how})${why ? `: ${why.slice(0, 200)}` : ""}` };
}

/**
 * @param {{ root: string, pipelinePath: string, url: string, done: boolean, cwd?: string, env?: NodeJS.ProcessEnv, historyPath?: string }} options
 */
export function recordInboxSkipHistory(options) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const codeRoot = resolveCodeRoot(cwd, env);
  const scanFile = resolveRootScript(codeRoot, "scan");
  if (!fs.existsSync(scanFile)) return Promise.resolve({ ok: false, error: "core-script-missing" });

  const historyFile = options.historyPath
    || (env.CAREER_OPS_SCAN_HISTORY || "").trim()
    || path.join(options.root, "data", "scan-history.tsv");
  let historyText = "";
  try {
    historyText = fs.readFileSync(historyFile, "utf8");
  } catch (err) {
    if (!err || err.code !== "ENOENT") return Promise.resolve({ ok: false, error: err?.message || "history unreadable" });
  }
  const plan = inboxSkipHistoryWrite(historyText, options.url, options.done);
  if (!plan) return Promise.resolve({ ok: true, wrote: 0 });

  let pipelineText = "";
  try {
    pipelineText = fs.readFileSync(options.pipelinePath, "utf8");
  } catch (err) {
    return Promise.resolve({ ok: false, error: err?.message || "pipeline unreadable" });
  }
  const offer = { ...inboxSkipHistoryOffer(pipelineText, options.url), status: plan.status, policy: plan.policy };

  const scanUrl = pathToFileURL(scanFile).href;
  const localTodayUrl = pathToFileURL(path.join(codeRoot, "lib", "local-today.mjs")).href;
  const code = `
import { appendToScanHistory } from ${JSON.stringify(scanUrl)};
import { localToday } from ${JSON.stringify(localTodayUrl)};
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", async () => {
  try {
    const offer = JSON.parse(input);
    const wrote = await appendToScanHistory(
      [{ url: offer.url, company: offer.company, title: offer.title, location: offer.location, source: offer.source }],
      localToday(),
      offer.status,
      offer.policy ? { historyPolicy: offer.policy } : {},
    );
    process.stdout.write(JSON.stringify({ ok: true, wrote: Number(wrote) || 0 }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
  }
});
`;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: codeRoot,
      env: { ...env, CAREER_OPS_ROOT: options.root, CAREER_OPS_SCAN_HISTORY: historyFile },
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => resolve({ ok: false, error: e instanceof Error ? e.message : "spawn failed" }));
    child.on("close", (code, signal) => resolve(writerResult(out, err, { code, signal })));
    child.stdin.write(JSON.stringify(offer));
    child.stdin.end();
  });
}
