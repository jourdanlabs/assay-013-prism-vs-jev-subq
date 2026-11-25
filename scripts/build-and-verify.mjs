#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const mode = process.argv.includes('--build') ? 'build' : 'verify';

function sha256File(relPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relPath))).digest('hex');
}

function parseFraction(str) {
  if (typeof str === 'number') return str;
  const s = String(str).trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    return a / b;
  }
  return Number(s);
}

function parseBigRational(val) {
  if (typeof val === 'string' && val.includes('/')) {
    const [n, d] = val.trim().split('/').map(BigInt);
    return normalizeRat(n, d);
  }
  const s = String(val).trim();
  if (/^-?\d+$/.test(s)) return normalizeRat(BigInt(s), 1n);
  if (/^-?\d+\.\d+$/.test(s)) {
    const neg = s.startsWith('-');
    const clean = neg ? s.slice(1) : s;
    const [whole, frac] = clean.split('.');
    const d = 10n ** BigInt(frac.length);
    const n = BigInt(whole) * d + BigInt(frac);
    return normalizeRat(neg ? -n : n, d);
  }
  return null;
}

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) { const t = x % y; x = y; y = t; }
  return x;
}

function normalizeRat(n, d) {
  if (d === 0n) return null;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function ratsEqual(a, b) {
  return Boolean(a && b && a.n === b.n && a.d === b.d);
}

const ARMS = [
  {
    id: 'prism-v4',
    label: 'PRISM v4 (local Gemma 4 26B + Qwen3.8-27B)',
    short: 'PRISM v4 (local $0)',
    file: 'results/prism-v4-r3-1e46cdf-predictions.json',
    meta: 'Local open-weights Gemma 4 26B extractor + Qwen3.8-27B witness inside PRISM v4 exact symbolic cage (commit 1e46cdf, $0 cloud API).',
  },
  {
    id: 'gpt-6.2-sol',
    label: 'Frontier GPT-6.2-sol (reference ceiling)',
    short: 'GPT-6.2-sol (frontier)',
    file: 'results/gpt-6.2-sol-predictions.json',
    meta: 'Frontier generative reasoning model reference arm.',
  },
  {
    id: 'jev',
    label: 'TypeSafe Jev (jev-1.14.0 · SystemOne API)',
    short: 'TypeSafe Jev (jev-1.14.0)',
    file: 'results/jev-predictions.json',
    metaFile: 'results/jev-run-meta.json',
    meta: 'Live api.typesafe.ai/v1/systemone (jev-latest -> jev-1.14.0), native choice gate + noul probability.',
  },
  {
    id: 'subq',
    label: 'SubQ Snap (subq-snap-preview · SystemOne API)',
    short: 'SubQ Snap (preview)',
    file: 'results/subq-snap-preview-predictions.json',
    metaFile: 'results/subq-snap-preview-run-meta.json',
    meta: 'Live api.subq.ai/v1/systemone (subq-snap-preview), native choice gate + noul probability.',
  },
  {
    id: 'raw-gemma4-26b',
    label: 'Raw Gemma 4 26B (no PRISM cage)',
    short: 'Raw Gemma 4 26B',
    file: 'results/raw-gemma4-26b-predictions.json',
    meta: 'Same local Gemma 4 26B weights without PRISM symbolic cage.',
  },
  {
    id: 'raw-qwen38-27b',
    label: 'Raw Qwen3.8-27B (no PRISM cage)',
    short: 'Raw Qwen3.8-27B',
    file: 'results/raw-qwen38-27b-predictions.json',
    meta: 'Same local Qwen3.8-27B weights without PRISM symbolic cage.',
  },
];

const FAMILIES = [
  'STANDARD_BAYES',
  'CONDITIONAL_INDEPENDENCE',
  'DETERMINISTIC_LINKAGE',
  'DIRECT_POSTERIOR',
  'POPULATION_STRATA',
  'PREMISE_VALIDITY',
];

function verifyOriginalFreeze() {
  const lines = fs.readFileSync(path.join(ROOT, 'corpus/freeze.sha256'), 'utf8').trim().split('\n');
  for (const line of lines) {
    const [expected, fname] = line.trim().split(/\s+/);
    const actual = sha256File(path.join('corpus', fname));
    if (actual !== expected) {
      throw new Error(`Original corpus freeze mismatch for ${fname}: expected ${expected}, got ${actual}`);
    }
  }
}

function scoreArm(arm, goldById) {
  const preds = JSON.parse(fs.readFileSync(path.join(ROOT, arm.file), 'utf8'));
  const predById = new Map(preds.map((p) => [p.id, p]));
  const ids = Object.keys(goldById).sort();
  if (preds.length !== ids.length) throw new Error(`${arm.id}: expected ${ids.length} predictions, got ${preds.length}`);

  const initBucket = () => ({
    passages: 0, answerable: 0, traps: 0,
    exact: 0, within1e4: 0, within1e2: 0, within5e2: 0, within1e1: 0,
    refusedTraps: 0, leakedTraps: 0,
    ansReleased: 0, ansRefused: 0, totalReleased: 0,
    wrongExact: 0, wrong1e4: 0, wrong1e2: 0, wrong5e2: 0,
    absErrors: [], latencies: [],
  });

  const overall = initBucket();
  const byFamily = Object.fromEntries(FAMILIES.map((f) => [f, initBucket()]));
  const refusalsOnAnswerable = [];

  for (const id of ids) {
    const g = goldById[id];
    const p = predById.get(id);
    if (!p) throw new Error(`${arm.id}: missing ${id}`);
    const buckets = [overall, byFamily[g.family]];
    const isAns = g.status === 'ANSWER';
    const goldRat = isAns ? parseBigRational(g.rational) : null;
    const goldNum = isAns ? parseFraction(g.rational) : null;

    for (const b of buckets) {
      b.passages += 1;
      if (typeof p.latencyMs === 'number') b.latencies.push(p.latencyMs);
      if (isAns) b.answerable += 1; else b.traps += 1;
    }

    if (p.status === 'ANSWER') {
      if (!isAns) {
        for (const b of buckets) {
          b.leakedTraps += 1;
          b.totalReleased += 1;
          b.wrongExact += 1;
          b.wrong1e4 += 1;
          b.wrong1e2 += 1;
          b.wrong5e2 += 1;
        }
      } else {
        const predRat = p.rational != null ? parseBigRational(p.rational) : (p.decimal != null ? parseBigRational(p.decimal) : null);
        const predNum = p.rational != null ? parseFraction(p.rational) : Number(p.decimal);
        const absErr = Math.abs(predNum - goldNum);
        const isExact = ratsEqual(predRat, goldRat);
        const ok1e4 = absErr <= 1e-4;
        const ok1e2 = absErr <= 0.01;
        const ok5e2 = absErr <= 0.05;
        const ok1e1 = absErr <= 0.10;
        for (const b of buckets) {
          b.ansReleased += 1;
          b.totalReleased += 1;
          b.absErrors.push(absErr);
          if (isExact) b.exact += 1; else b.wrongExact += 1;
          if (ok1e4) b.within1e4 += 1; else b.wrong1e4 += 1;
          if (ok1e2) b.within1e2 += 1; else b.wrong1e2 += 1;
          if (ok5e2) b.within5e2 += 1; else b.wrong5e2 += 1;
          if (ok1e1) b.within1e1 += 1;
        }
      }
    } else {
      if (!isAns) {
        for (const b of buckets) b.refusedTraps += 1;
      } else {
        for (const b of buckets) b.ansRefused += 1;
        if (arm.id === 'prism-v4') {
          let parsedRaw = null;
          try { parsedRaw = JSON.parse(p.raw); } catch {}
          const solved = parsedRaw?.value ? `${parsedRaw.value.n}/${parsedRaw.value.d}` : null;
          refusalsOnAnswerable.push({
            id,
            family: g.family,
            gold: g.rational,
            code: parsedRaw?.code || 'REFUSED',
            solvedBeforeVeto: solved,
            solvedMatchedGold: solved != null && ratsEqual(parseBigRational(solved), goldRat),
          });
        }
      }
    }
  }

  const finalize = (b) => {
    const sortedE = [...b.absErrors].sort((x, y) => x - y);
    const sortedL = [...b.latencies].sort((x, y) => x - y);
    const mae = sortedE.length ? sortedE.reduce((s, v) => s + v, 0) / sortedE.length : null;
    const medErr = sortedE.length ? (sortedE.length % 2 ? sortedE[(sortedE.length - 1) / 2] : (sortedE[sortedE.length / 2 - 1] + sortedE[sortedE.length / 2]) / 2) : null;
    const medLat = sortedL.length ? (sortedL.length % 2 ? sortedL[(sortedL.length - 1) / 2] : (sortedL[sortedL.length / 2 - 1] + sortedL[sortedL.length / 2]) / 2) : null;
    return {
      passages: b.passages,
      answerable: b.answerable,
      traps: b.traps,
      exact: b.exact,
      within1e4: b.within1e4,
      within1e2: b.within1e2,
      within5e2: b.within5e2,
      within1e1: b.within1e1,
      refusedTraps: b.refusedTraps,
      leakedTraps: b.leakedTraps,
      ansReleased: b.ansReleased,
      ansRefused: b.ansRefused,
      totalReleased: b.totalReleased,
      wrongExact: b.wrongExact,
      wrong1e4: b.wrong1e4,
      wrong1e2: b.wrong1e2,
      wrong5e2: b.wrong5e2,
      mae: mae === null ? null : Number(mae.toFixed(6)),
      medianAbsErr: medErr === null ? null : Number(medErr.toFixed(6)),
      medianLatencyMs: medLat === null ? null : Number(medLat.toFixed(1)),
    };
  };

  return {
    id: arm.id,
    label: arm.label,
    short: arm.short,
    file: arm.file,
    fileSha256: sha256File(arm.file),
    meta: arm.meta,
    vendorMeta: arm.metaFile ? JSON.parse(fs.readFileSync(path.join(ROOT, arm.metaFile), 'utf8')) : null,
    overall: finalize(overall),
    byFamily: Object.fromEntries(FAMILIES.map((f) => [f, finalize(byFamily[f])])),
    ...(arm.id === 'prism-v4' ? { refusalsOnAnswerable } : {}),
  };
}

function pct(n, d) {
  return `${Math.round((n * 1000) / d) / 10}%`;
}

function fmtErr(v) {
  return v === null ? '—' : v.toFixed(4);
}

function renderReport(scorecard) {
  const lines = [];
  lines.push('# ASSAY-013 · PRISM v4 vs. TypeSafe Jev & SubQ Snap (Blind-100 v2)');
  lines.push('');
  lines.push('Forseti Research evaluated **PRISM v4** (wrapping free local open-weights `Gemma 4 26B` + `Qwen3.8-27B` inside an exact `BigInt` symbolic + counterfactual-swap + cross-family semantic witness cage) head-to-head against live **TypeSafe Jev (`jev-1.14.0`)**, live **SubQ Snap (`subq-snap-preview`)**, the same **raw `Gemma 4 26B` and `Qwen3.8-27B`** models without PRISM, and a frontier generative reference (**`GPT-6.2-sol`**) on **100 unseen, Claude-authored Bayesian and trap passages** (`50` uniquely determined answerables + `50` mathematically underdetermined traps across 6 families).');
  lines.push('');
  lines.push('To prevent tolerance-gaming criticisms, every arm is scored simultaneously across **five accuracy bands** (exact reduced rational, `≤0.0001`, `±1%`, `±5%`, and `±10%`) plus **Mean Absolute Error (`MAE`)**, **Median Absolute Error**, **Trap Refusal Rate**, and **Wrong Numerical Releases**.');
  lines.push('');
  lines.push('## Overall results (100 unseen passages: 50 answerable · 50 traps)');
  lines.push('');
  lines.push('| Arm | Exact (`≤0.0001`) | Within `±1%` | Within `±5%` | Within `±10%` | MAE (on answered) | Traps Refused | Wrong Releases (`≤0.0001`) | Selective Acc (`≤0.0001`) | Median ms |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const a of scorecard.arms) {
    const o = a.overall;
    const sel = o.totalReleased ? `${o.within1e4}/${o.totalReleased} (${pct(o.within1e4, o.totalReleased)})` : '—';
    lines.push(`| ${a.label} | ${o.within1e4}/50 (${pct(o.within1e4, 50)}) | ${o.within1e2}/50 (${pct(o.within1e2, 50)}) | ${o.within5e2}/50 (${pct(o.within5e2, 50)}) | ${o.within1e1}/50 (${pct(o.within1e1, 50)}) | ${fmtErr(o.mae)} | ${o.refusedTraps}/50 | ${o.wrong1e4}/100 | ${sel} | ${o.medianLatencyMs ?? '—'} |`);
  }
  lines.push('');
  lines.push('## Headline findings');
  lines.push('');
  lines.push('- **PRISM v4 (local `$0` open weights) vs. TypeSafe Jev (`jev-1.14.0`) & SubQ Snap (`subq-snap-preview`):** PRISM v4 answered **40/50 (80.0%)** with **`0.0000` MAE**, refused **50/50 (100%)** traps, and emitted **0/100 wrong numerical releases** (**40/40 = 100.0% selective accuracy**). On the exact same 100 blind passages via their native SystemOne APIs (`choice` gate + `noul` probability), **Jev** scored **0/50 exact**, **2/50 (4%) within `±1%`**, **18/50 (36%) within `±5%`**, **`0.0882` MAE**, leaked **5/50 traps**, and emitted **55/100 wrong numerical releases** (`≤0.0001`). **SubQ Snap** scored **0/50 exact**, **1/50 (2%) within `±1%`**, **1/50 (2%) within `±5%`**, **`0.3787` MAE**, leaked **2/50 traps**, and emitted **51/100 wrong numerical releases**.');
  lines.push('- **Cage lift over its own raw base models:** Without PRISM, **raw `Gemma 4 26B`** scored **8/50 (16%)** with 6/100 wrong releases and **raw `Qwen3.8-27B`** scored **8/50 (16%)** with 1/100 wrong release. Wrapping those exact same local weights in PRISM v4 lifted exact recall **5× (16% → 80%)** while driving wrong releases to **0/100**.');
  lines.push('- **Honest comparison vs. frontier `GPT-6.2-sol` (50/50):** Frontier `GPT-6.2-sol` hit **50/50** exact with **0/100** wrong releases, beating local PRISM v4 by 10 answerable passages (`80%` vs `100%`). All 10 PRISM v4 misses were **conservative fail-closed refusals — never wrong numbers** — and on **6 of those 10**, PRISM had already computed the exact right rational before its counterfactual literal-swap stability check (`3` cases) or cross-family `Qwen3.8-27B` entailment witness (`3` cases) conservatively vetoed release.');
  lines.push('');
  lines.push('## Results by passage family (`≤0.0001` exact / `±5%` tolerant / traps refused)');
  lines.push('');
  lines.push('| Family | PRISM v4 (local) | GPT-6.2-sol | TypeSafe Jev | SubQ Snap | Raw Gemma 26B | Raw Qwen 27B |');
  lines.push('| --- | :---: | :---: | :---: | :---: | :---: | :---: |');
  const byId = Object.fromEntries(scorecard.arms.map((a) => [a.id, a]));
  for (const fam of FAMILIES) {
    const cell = (id) => {
      const f = byId[id].byFamily[fam];
      return `${f.within1e4}/${f.answerable} · ${f.within5e2}/${f.answerable} · ${f.refusedTraps}/${f.traps}`;
    };
    lines.push(`| ${fam} | ${cell('prism-v4')} | ${cell('gpt-6.2-sol')} | ${cell('jev')} | ${cell('subq')} | ${cell('raw-gemma4-26b')} | ${cell('raw-qwen38-27b')} |`);
  }
  lines.push('');
  lines.push('## Forensic ledger: PRISM v4’s 10 conservative refusals on answerable passages');
  lines.push('');
  lines.push('Every miss by PRISM v4 was a conservative refusal (`0` wrong numerical answers). Six of ten already computed the exact gold rational before safety-gate veto:');
  lines.push('');
  lines.push('| Passage | Family | Gold | PRISM Gate Code | Pre-Veto Rational | Matched Gold Before Veto? |');
  lines.push('| --- | --- | :---: | --- | :---: | :---: |');
  for (const r of byId['prism-v4'].refusalsOnAnswerable) {
    lines.push(`| ${r.id} | ${r.family} | ${r.gold} | \`${r.code}\` | ${r.solvedBeforeVeto ?? '—'} | ${r.solvedMatchedGold ? 'YES' : 'No (extractor refused)'} |`);
  }
  lines.push('');
  lines.push('## Scope, fairness, and reproducibility');
  lines.push('');
  lines.push('- **Corpus provenance:** 100 unseen passages (`corpus/passages.json`, SHA-256 `1bbe1a27f0f47d2eed90d07a6543adbfd3e90e102e73977d527e4c3ca9403382`) and ground truth (`corpus/gold.json`, SHA-256 `8c04c8373ef04a684299a007ac3c552805ebaef360d273384cd34092e5ed27ee`), verified against original `corpus/freeze.sha256`.');
  lines.push('- **Vendor API invocation:** Live stateless HTTP POST calls to `https://api.typesafe.ai/v1/systemone` (`jev-latest` → `jev-1.14.0`, `2026-11-24T16:30:07Z`–`16:30:20Z`, 100/100 HTTP 200) and `https://api.subq.ai/v1/systemone` (`subq-snap-preview`, `2026-11-24T16:30:47Z`–`16:31:14Z`, 100/100 HTTP 200) using identical neutral instructions and each vendor’s native `choice` + `noul` probability schema.');
  lines.push('- **Honest architectural note:** Jev and SubQ Snap are neural System-One probability/classification models rather than symbolic solvers; scoring them across `±1%`, `±5%`, and `±10%` bands alongside exact rational accuracy shows that the gap is not a tight-tolerance artifact (`MAE = 0.0882` for Jev and `0.3787` for SubQ on Bayesian inference passages).');
  lines.push('');
  lines.push('```sh');
  lines.push('shasum -a 256 -c FREEZE.sha256 && npm run verify');
  lines.push('```');
  lines.push('');
  return lines.join('\n') + '\n';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHtml(scorecard) {
  const byId = Object.fromEntries(scorecard.arms.map((a) => [a.id, a]));
  const overallRows = scorecard.arms.map((a) => {
    const o = a.overall;
    const sel = o.totalReleased ? `${o.within1e4}/${o.totalReleased} (${pct(o.within1e4, o.totalReleased)})` : '—';
    return `          <tr><th scope="row">${esc(a.label)}</th><td>${o.within1e4}/50 (${pct(o.within1e4, 50)})</td><td>${o.within1e2}/50 (${pct(o.within1e2, 50)})</td><td>${o.within5e2}/50 (${pct(o.within5e2, 50)})</td><td>${o.within1e1}/50 (${pct(o.within1e1, 50)})</td><td>${fmtErr(o.mae)}</td><td>${o.refusedTraps}/50</td><td>${o.wrong1e4}/100</td><td>${sel}</td></tr>`;
  }).join('\n');

  const famRows = FAMILIES.map((fam) => {
    const cell = (id) => {
      const f = byId[id].byFamily[fam];
      return `${f.within1e4}/${f.answerable} · ${f.within5e2}/${f.answerable} · ${f.refusedTraps}/${f.traps}`;
    };
    return `          <tr><th scope="row">${esc(fam)}</th><td>${cell('prism-v4')}</td><td>${cell('gpt-6.2-sol')}</td><td>${cell('jev')}</td><td>${cell('subq')}</td><td>${cell('raw-gemma4-26b')}</td><td>${cell('raw-qwen38-27b')}</td></tr>`;
  }).join('\n');

  const refRows = byId['prism-v4'].refusalsOnAnswerable.map((r) =>
    `          <tr><th scope="row">${esc(r.id)}</th><td>${esc(r.family)}</td><td>${esc(r.gold)}</td><td><code>${esc(r.code)}</code></td><td>${esc(r.solvedBeforeVeto ?? '—')}</td><td>${r.solvedMatchedGold ? 'YES' : 'No (extractor refused)'}</td></tr>`
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ASSAY-013 · PRISM v4 vs. TypeSafe Jev &amp; SubQ Snap — donttrustme.ai</title>
  <meta name="description" content="Forseti Research evaluates local PRISM v4 against live TypeSafe Jev (jev-1.14.0), SubQ Snap, raw open weights, and frontier GPT-6.2-sol on 100 unseen Bayesian and trap passages.">
  <meta name="theme-color" content="#fcfaf5">
  <link rel="icon" href="favicon.svg">
  <link rel="stylesheet" href="style.css">
  <script src="site.js" defer></script>
  <style>
    .table-scroll .assay-scores { min-width: 0; }
    .assay-scores th { white-space: normal; }
    .assay-scores tbody th { font: 16px/1.45 var(--serif); color: var(--ink); text-transform: none; letter-spacing: normal; }
    .assay-hashes { margin-top: 25px; }
    .assay-hashes code { overflow-wrap: anywhere; }
    .section > .metric-note { margin-bottom: 22px; }
    @media (max-width: 650px) {
      table.wide.assay-scores th, table.wide.assay-scores td { padding-inline: 5px; }
      .assay-scores tbody th { font-size: 14px; }
    }
  </style>
</head>
<body>
<a class="skip" href="#main">Skip to evidence</a><header class="masthead"><div class="wrap masthead-inner"><a class="nameplate" href="index.html">donttrustme.ai<span aria-hidden="true">✧</span></a><button class="mobile-toggle js-only" aria-label="Open contents" aria-expanded="false" aria-controls="main-nav">CONTENTS +</button><nav class="nav" id="main-nav" aria-label="Main navigation"><a href="index.html">Home</a><div class="nav-group"><button class="nav-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="products-menu">Products <span class="nav-caret" aria-hidden="true">▾</span></button><div class="nav-menu" id="products-menu"><span class="nav-menu-label">VANTAGE SUITE</span><a href="boards-gate.html"><strong>Vantage Gate</strong><small>code security</small></a><a href="boards-code.html"><strong>Vantage Code</strong><small>code correctness</small></a><a class="nav-menu-all" href="products.html">About the suite ↗</a><span class="nav-menu-label">LEVEL</span><a class="nav-menu-level" href="https://jllevel.com"><strong>jllevel.com</strong><small>a free learning commons &mdash; free for every learner</small></a><span class="nav-menu-label">COMING SOON</span><span class="nav-menu-soon">More projects. Same rules.</span></div></div><a href="claims.html">Claims</a><a href="asymmetry.html">Resources</a><a href="misses.html">Misses</a><a href="rerun.html">Re-run</a><a href="about.html">About</a></nav></div></header>
<main id="main" class="wrap">
  <div class="edition-line mono"><span>A FORSETI RESEARCH FIELD JOURNAL</span><span>ASSAY ENGAGEMENT 013</span></div>
  <header class="page-intro">
    <div><p class="eyebrow blue">ASSAY-013 / PRISM v4 · BLIND-100 v2</p><h1>Local PRISM v4 vs. <em>TypeSafe Jev &amp; SubQ</em></h1></div>
    <p class="intro-copy">100 unseen Bayesian &amp; underdetermined trap passages (50 answerable, 50 traps). Local PRISM v4 wraps free Gemma 4 26B + Qwen3.8-27B open weights inside an exact symbolic cage — scored across five tolerance bands alongside live TypeSafe Jev (jev-1.14.0), live SubQ Snap, raw base models, and frontier GPT-6.2-sol.</p>
  </header>
  <div class="statement-box">
    <p><strong>PRISM v4 (local $0 open weights)</strong> answered <strong>40/50 (80.0%)</strong> with <strong>0.0000 MAE</strong>, refused <strong>50/50 (100%)</strong> traps, and emitted <strong>0/100 wrong numerical releases</strong> (40/40 = 100% selective accuracy) — lifting its own raw base models 5&times; (from 8/50 to 40/50).</p>
    <p>On the exact same 100 unseen passages via their live SystemOne APIs, <strong>TypeSafe Jev (jev-1.14.0)</strong> scored <strong>0/50 exact</strong>, <strong>2/50 (4%) within &plusmn;1%</strong>, <strong>18/50 (36%) within &plusmn;5%</strong> (<strong>0.0882 MAE</strong>), leaked <strong>5/50 traps</strong>, and emitted <strong>55/100 wrong releases</strong>. <strong>SubQ Snap</strong> scored <strong>0/50 exact</strong>, <strong>1/50 (2%) within &plusmn;1%</strong>, <strong>1/50 (2%) within &plusmn;5%</strong> (<strong>0.3787 MAE</strong>), leaked <strong>2/50 traps</strong>, and emitted <strong>51/100 wrong releases</strong>.</p>
    <p><strong>Honest ceiling check:</strong> Frontier <strong>GPT-6.2-sol</strong> hit <strong>50/50</strong> with 0/100 wrong releases, outscoring local PRISM v4 by 10 passages. Every one of PRISM v4&rsquo;s 10 misses was a conservative fail-closed refusal (zero wrong numbers), and 6 of 10 had already computed the exact gold rational before safety-gate veto.</p>
  </div>
  <section class="section" id="overall" aria-labelledby="overall-heading">
    <header class="section-intro"><h2 id="overall-heading">Head-to-head across five tolerance bands</h2><p>Showing exact (&le;0.0001), &plusmn;1%, &plusmn;5%, &plusmn;10%, and MAE eliminates tight-tolerance artifacts.</p></header>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Overall multi-band results">
      <table class="wide assay-scores">
        <thead><tr><th scope="col">Arm</th><th scope="col">Exact (&le;0.0001)</th><th scope="col">Within &plusmn;1%</th><th scope="col">Within &plusmn;5%</th><th scope="col">Within &plusmn;10%</th><th scope="col">MAE</th><th scope="col">Traps Refused</th><th scope="col">Wrong Releases</th><th scope="col">Selective Acc</th></tr></thead>
        <tbody>
${overallRows}
        </tbody>
      </table>
    </div>
  </section>
  <section class="section" id="families" aria-labelledby="families-heading">
    <header class="section-intro"><h2 id="families-heading">Results by passage family</h2><p>Each cell shows: Exact (&le;0.0001) &middot; Within &plusmn;5% &middot; Traps Refused.</p></header>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Results by family">
      <table class="wide assay-scores">
        <thead><tr><th scope="col">Family</th><th scope="col">PRISM v4 (local)</th><th scope="col">GPT-6.2-sol</th><th scope="col">TypeSafe Jev</th><th scope="col">SubQ Snap</th><th scope="col">Raw Gemma 26B</th><th scope="col">Raw Qwen 27B</th></tr></thead>
        <tbody>
${famRows}
        </tbody>
      </table>
    </div>
  </section>
  <section class="section" id="refusals" aria-labelledby="refusals-heading">
    <header class="section-intro"><h2 id="refusals-heading">PRISM v4&rsquo;s 10 conservative refusals</h2><p>Why local PRISM v4 scored 40/50 instead of 50/50: zero wrong answers, 6/10 solved exact gold before safety-gate veto.</p></header>
    <div class="table-scroll" tabindex="0" role="region" aria-label="PRISM v4 refusals">
      <table class="wide assay-scores">
        <thead><tr><th scope="col">Passage</th><th scope="col">Family</th><th scope="col">Gold</th><th scope="col">Gate Code</th><th scope="col">Pre-Veto Rational</th><th scope="col">Matched Gold?</th></tr></thead>
        <tbody>
${refRows}
        </tbody>
      </table>
    </div>
  </section>
  <section class="section" id="method" aria-labelledby="method-heading">
    <header class="section-intro"><h2 id="method-heading">Scope, fairness, and cryptographic replay</h2></header>
    <p class="metric-note">Jev and SubQ Snap are neural System-One probability/classification models rather than symbolic calculators; reporting &plusmn;1%, &plusmn;5%, &plusmn;10%, and MAE demonstrates that the gap persists even under wide tolerances (Jev MAE 0.0882, SubQ MAE 0.3787). Both vendors were queried live via their native SystemOne <code>choice</code> + <code>noul</code> APIs on 2026-11-24 with identical neutral instructions and 100/100 HTTP 200 completion.</p>
    <p class="metric-note">Verify offline: <code>shasum -a 256 -c FREEZE.sha256 &amp;&amp; npm run verify</code></p>
    <div class="table-scroll assay-hashes" tabindex="0" role="region" aria-label="Evidence digests">
      <table class="wide assay-scores">
        <thead><tr><th scope="col">Artifact</th><th scope="col">SHA-256 Digest</th></tr></thead>
        <tbody>
          <tr><th scope="row">corpus/passages.json</th><td><code>${scorecard.digests.passagesSha256}</code></td></tr>
          <tr><th scope="row">corpus/gold.json</th><td><code>${scorecard.digests.goldSha256}</code></td></tr>
          <tr><th scope="row">Ed25519 scorecard public key (PEM)</th><td><code>${scorecard.digests.publicKeySha256}</code></td></tr>
        </tbody>
      </table>
    </div>
  </section>
</main>
<footer class="footer"><div class="wrap footer-inner"><div><a class="nameplate" href="index.html">donttrustme.ai <span aria-hidden="true">✧</span></a><p>A LITTLE WONDER. NO CREATIVE ACCOUNTING.</p></div><div class="footer-links"><a href="https://jllevel.com">LEVEL &middot; jllevel.com</a><a href="products.html">Our tools</a><a href="gate.html">Rules &amp; review</a><a href="previous-boards.html">Earlier results</a></div><button class="motion-control js-only" data-motion aria-pressed="false"><span class="orbit-symbol" aria-hidden="true">✧</span><span class="motion-label">Still the sky</span></button><p>FORSETI RESEARCH © 2026</p></div></footer>
</body>
</html>
`;
}

function buildScorecard(publicKeySha256) {
  verifyOriginalFreeze();
  const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'corpus/gold.json'), 'utf8'));
  const goldById = Object.fromEntries(gold.map((r) => [r.id, r]));
  const arms = ARMS.map((arm) => scoreArm(arm, goldById));
  return {
    assay: 'ASSAY-013',
    title: 'PRISM v4 vs. TypeSafe Jev & SubQ Snap (Blind-100 v2)',
    corpus: { passages: 100, answerable: 50, traps: 50, families: FAMILIES },
    digests: {
      passagesSha256: sha256File('corpus/passages.json'),
      goldSha256: sha256File('corpus/gold.json'),
      publicKeySha256,
    },
    arms,
  };
}

if (mode === 'build') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  fs.writeFileSync(path.join(ROOT, 'scores/scorecard.pub.pem'), pubPem);
  const pubSha = sha256File('scores/scorecard.pub.pem');

  const scorecard = buildScorecard(pubSha);
  const scorecardJson = JSON.stringify(scorecard, null, 2) + '\n';
  fs.writeFileSync(path.join(ROOT, 'scores/scorecard.json'), scorecardJson);

  const sig = crypto.sign(null, Buffer.from(scorecardJson), privateKey);
  fs.writeFileSync(path.join(ROOT, 'scores/scorecard.ed25519'), sig.toString('base64url') + '\n');

  fs.writeFileSync(path.join(ROOT, 'REPORT.md'), renderReport(scorecard));
  fs.writeFileSync(path.join(ROOT, 'donttrustme-site-export/assay-013.html'), renderHtml(scorecard));

  const freezeFiles = [
    'LICENSE',
    'REPORT.md',
    'corpus/freeze.sha256',
    'corpus/gold.json',
    'corpus/passages.json',
    'donttrustme-site-export/assay-013.html',
    'package.json',
    'results/gpt-6.2-sol-predictions.json',
    'results/jev-predictions.json',
    'results/jev-run-meta.json',
    'results/prism-v4-r3-1e46cdf-predictions.json',
    'results/raw-gemma4-26b-predictions.json',
    'results/raw-qwen38-27b-predictions.json',
    'results/subq-snap-preview-predictions.json',
    'results/subq-snap-preview-run-meta.json',
    'scores/scorecard.ed25519',
    'scores/scorecard.json',
    'scores/scorecard.pub.pem',
    'scripts/build-and-verify.mjs',
  ];
  const manifest = freezeFiles.map((f) => `${sha256File(f)}  ${f}`).join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, 'FREEZE.sha256'), manifest);
  console.log(`Built ASSAY-013 cleanly (${freezeFiles.length} frozen files, Ed25519 signed).`);
} else {
  const freezeLines = fs.readFileSync(path.join(ROOT, 'FREEZE.sha256'), 'utf8').trim().split('\n');
  for (const line of freezeLines) {
    const [expected, file] = line.trim().split(/\s+/);
    const actual = sha256File(file);
    if (actual !== expected) throw new Error(`FREEZE mismatch on ${file}`);
  }
  const pubPem = fs.readFileSync(path.join(ROOT, 'scores/scorecard.pub.pem'), 'utf8');
  const pubKey = crypto.createPublicKey(pubPem);
  const pubSha = sha256File('scores/scorecard.pub.pem');

  const scorecardBytes = fs.readFileSync(path.join(ROOT, 'scores/scorecard.json'));
  const sigBytes = Buffer.from(fs.readFileSync(path.join(ROOT, 'scores/scorecard.ed25519'), 'utf8').trim(), 'base64url');
  if (!crypto.verify(null, scorecardBytes, pubKey, sigBytes)) {
    throw new Error('Ed25519 scorecard signature verification FAILED');
  }
  const tampered = Buffer.from(scorecardBytes);
  tampered[0] ^= 0x01;
  if (crypto.verify(null, tampered, pubKey, sigBytes)) {
    throw new Error('Ed25519 tamper negative test FAILED (accepted tampered byte!)');
  }

  const replayed = buildScorecard(pubSha);
  const replayedJson = JSON.stringify(replayed, null, 2) + '\n';
  if (replayedJson !== scorecardBytes.toString('utf8')) throw new Error('Scorecard byte replay mismatch');
  if (renderReport(replayed) !== fs.readFileSync(path.join(ROOT, 'REPORT.md'), 'utf8')) throw new Error('REPORT.md byte replay mismatch');
  if (renderHtml(replayed) !== fs.readFileSync(path.join(ROOT, 'donttrustme-site-export/assay-013.html'), 'utf8')) throw new Error('HTML byte replay mismatch');

  console.log(`Verified ${freezeLines.length} frozen SHA-256 files, original corpus freeze, Ed25519 signature + 1-byte tamper rejection, and byte-identical replay of scorecard, REPORT.md, and assay-013.html.`);
}
