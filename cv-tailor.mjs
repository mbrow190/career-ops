#!/usr/bin/env node

/**
 * Merge per-job headline, summary, and skill order onto a CV payload.
 * Facts must already exist in the payload. This script reorders and
 * rewrites wording the agent already grounded in cv.md.
 *
 * Usage:
 *   node cv-tailor.mjs <payload.json> [--headline=...] [--summary=...] [--skill-order=A,B]
 *   node cv-tailor.mjs <payload.json> --tailor=<file.json|file.yml>
 *   node cv-tailor.mjs --self-test
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { isMainModule } from './lib/is-main-module.mjs';

function loadJsonOrYaml(text, label) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error(`${label} is empty`);
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const doc = {};
  let currentList = null;
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    const list = line.match(/^\s*-\s+(.*)$/);
    if (list && currentList) {
      currentList.push(list[1].replace(/^["']|["']$/g, '').trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].replace(/^["']|["']$/g, '').trim();
    if (value === '' || value === '|' || value === '>') {
      currentList = [];
      doc[key] = currentList;
    } else {
      currentList = null;
      doc[key] = value;
    }
  }
  return doc;
}

function skillItems(entry) {
  if (Array.isArray(entry?.items)) return entry.items.map((item) => String(item).trim()).filter(Boolean);
  return String(entry?.items || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function skillKey(value) {
  return String(value || '').replace(/:\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function applyCvTailor(payload, tailor = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be an object');
  }
  const next = {
    ...payload,
    candidate: { ...(payload.candidate || {}) },
    skills: Array.isArray(payload.skills) ? payload.skills.map((row) => ({ ...row })) : [],
  };

  const headline = tailor.headline ?? tailor.title;
  if (headline !== undefined && String(headline).trim()) {
    next.candidate.title = String(headline).trim();
  }

  if (tailor.summary !== undefined && String(tailor.summary).trim()) {
    next.summary = String(tailor.summary).trim();
  }

  const order = Array.isArray(tailor.skill_order)
    ? tailor.skill_order
    : String(tailor.skill_order || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  if (order.length) {
    const known = new Set();
    for (const row of next.skills) {
      if (row.category) known.add(skillKey(row.category));
      for (const item of skillItems(row)) known.add(skillKey(item));
    }
    const unknown = order.filter((name) => !known.has(skillKey(name)));
    if (unknown.length) {
      throw new Error(`skill_order names facts that are not in the payload: ${unknown.join(', ')}`);
    }

    const used = new Set();
    const ranked = [];
    for (const name of order) {
      const key = skillKey(name);
      const byCategory = next.skills.findIndex((row, index) => !used.has(index) && skillKey(row.category) === key);
      if (byCategory >= 0) {
        used.add(byCategory);
        ranked.push(next.skills[byCategory]);
        continue;
      }
      const byItem = next.skills.findIndex((row, index) => !used.has(index) && skillItems(row).some((item) => skillKey(item) === key));
      if (byItem >= 0) {
        used.add(byItem);
        const row = { ...next.skills[byItem] };
        const items = skillItems(row);
        const hit = items.filter((item) => skillKey(item) === key);
        const rest = items.filter((item) => skillKey(item) !== key);
        row.items = [...hit, ...rest];
        ranked.push(row);
      }
    }
    for (const [index, row] of next.skills.entries()) {
      if (!used.has(index)) ranked.push(row);
    }
    next.skills = ranked;
  }

  return next;
}

function parseArgs(argv) {
  const opts = { input: '', tailorPath: '', headline: '', summary: '', skillOrder: '', selfTest: false };
  for (const arg of argv) {
    if (arg === '--self-test') opts.selfTest = true;
    else if (arg.startsWith('--tailor=')) opts.tailorPath = arg.slice('--tailor='.length);
    else if (arg.startsWith('--headline=')) opts.headline = arg.slice('--headline='.length);
    else if (arg.startsWith('--summary=')) opts.summary = arg.slice('--summary='.length);
    else if (arg.startsWith('--skill-order=')) opts.skillOrder = arg.slice('--skill-order='.length);
    else if (!arg.startsWith('--') && !opts.input) opts.input = arg;
  }
  return opts;
}

function selfTest() {
  const payload = {
    candidate: { name: 'Alex Rivera', title: 'Engineer' },
    summary: 'Builds APIs.',
    skills: [
      { category: 'Cloud', items: ['AWS', 'GCP'] },
      { category: 'Languages', items: ['Python', 'Go'] },
    ],
  };
  const tailored = applyCvTailor(payload, {
    headline: 'Senior Backend Engineer',
    summary: 'Builds APIs in Python.',
    skill_order: ['Languages', 'Python'],
  });
  const checks = [
    [tailored.candidate.title === 'Senior Backend Engineer', 'headline'],
    [tailored.summary === 'Builds APIs in Python.', 'summary'],
    [tailored.skills[0].category === 'Languages', 'skill category order'],
    [tailored.skills[0].items[0] === 'Python', 'skill item order'],
    [payload.skills[0].category === 'Cloud', 'input not mutated'],
  ];
  let failed = false;
  try {
    applyCvTailor(payload, { skill_order: ['Rust'] });
    failed = true;
  } catch {
    checks.push([true, 'unknown skill rejected']);
  }
  if (failed) checks.push([false, 'unknown skill rejected']);
  for (const [ok, name] of checks) {
    if (!ok) {
      console.error(`self-test failed: ${name}`);
      process.exit(1);
    }
  }
  console.log('cv-tailor.mjs self-test passed');
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.selfTest) {
    selfTest();
    return;
  }
  if (!opts.input) {
    console.error('Usage: node cv-tailor.mjs <payload.json> [--tailor=file] [--headline=...] [--summary=...] [--skill-order=A,B]');
    process.exit(1);
  }
  const payload = JSON.parse(readFileSync(resolve(opts.input), 'utf-8'));
  const fromFile = opts.tailorPath
    ? loadJsonOrYaml(readFileSync(resolve(opts.tailorPath), 'utf-8'), opts.tailorPath)
    : {};
  const tailor = {
    ...fromFile,
    ...(opts.headline ? { headline: opts.headline } : {}),
    ...(opts.summary ? { summary: opts.summary } : {}),
    ...(opts.skillOrder ? { skill_order: opts.skillOrder } : {}),
  };
  const next = applyCvTailor(payload, tailor);
  writeFileSync(resolve(opts.input), `${JSON.stringify(next, null, 2)}\n`);
  console.log(`tailored ${opts.input}`);
}

if (isMainModule(import.meta.url)) {
  main();
}
