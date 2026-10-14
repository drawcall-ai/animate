// `pnpm judge <scenario>`: a scenario run headless (and seeded variations of it), judged, and told
// as a short report, the worst first — each failure with when, where, the beat running then and the
// usual fix. Loaded by scripts/judge.mjs, which resolves '@drawcall/animate' to the beats tracer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SCENARIOS } from '../src/scenarios';
import { label, type Beat } from './beats';
import { excess, failed, type Check } from './judge';
import { BELL, GAZE_LEAD } from './flow';
import { beatAt, run, vary, type Run } from './run';

export interface Options {
  vary: number;
  json: boolean;
  look: boolean;
}

/** a moment to look at: when, why, and yes/no questions for a vision model */
export interface Event {
  t: number;
  why: string;
  questions: string[];
}

/** judges scenario `id` and prints the report; whether a check failed, and the moments to look at */
export function main(id: string, options: Options): { failed: boolean; events: Event[] } {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) throw new Error(`no scenario "${id}" (known: ${SCENARIOS.map((s) => s.id).join(', ')})`);
  const started = performance.now();
  const base = run(sc);
  const variations = Array.from({ length: options.vary }, (_, i) => run(vary(sc, i + 1)));
  const seconds = (performance.now() - started) / 1000;
  const runs = [base, ...variations];
  const lines = [...report(base, seconds, runs.length), ...variationLines(variations)];
  if (options.json) lines.push(...save(id, runs));
  console.log(lines.join('\n'));
  return { failed: runs.some((r) => r.checks.some((c) => failed(c) && !c.advisory)), events: options.look ? events(base) : [] };
}

/** the base run's report: a headline, the failures worst first with their fixes, the flow, the checks passed */
function report(r: Run, seconds: number, count: number): string[] {
  const held = r.checks.filter((c) => !c.advisory);
  const fails = held.filter(failed).sort((a, b) => excess(b) - excess(a));
  const lines = [
    `${r.scenario.id}  ${fails.length ? `FAIL ${fails.length} of ${held.length}` : `PASS ${held.length}`} · done ${r.done ? '✓' : '✗'} · ${r.scenario.duration.toFixed(0)} s × ${count} run${count > 1 ? 's' : ''} in ${seconds.toFixed(1)} s${r.own ? '' : ' · universal limits (no LIMITS entry)'}`,
  ];
  const fixes = new Set<string>();
  for (const c of fails.slice(0, 10)) {
    lines.push(`✗ ${line(c, r.beats)}`);
    if (!fixes.has(c.fix)) lines.push(`    fix: ${c.fix}`);
    fixes.add(c.fix);
  }
  if (fails.length > 10) lines.push(`  … ${fails.length - 10} more`);
  lines.push(...flowLines(r));
  return lines;
}

/** a check as a line: what, its value against its limit, when, where, the beat then */
function line(c: Check, log: readonly Beat[]): string {
  const op = c.bound === 'max' ? '≤' : c.bound === 'min' ? '≥' : '=';
  const beat = beatAt(log, c.at);
  return `${c.what}: ${num(c.value)} (${op} ${num(c.limit)})${c.at === undefined ? '' : ` @${c.at.toFixed(2)}s`}${c.where ? ` ${c.where}` : ''}${beat ? `  [${beat}]` : ''}`;
}

/** the flow: each metric's instances in brief, the advisory ones off their mark flagged (!) with their fix */
function flowLines(r: Run): string[] {
  const f = r.flow;
  const s = (t: number) => `@${t.toFixed(1)}`;
  /** the worst three of `xs` by `by` (descending), each told by `tell`, and how many more */
  const worst = <T>(xs: T[], by: (x: T) => number, tell: (x: T) => string) => {
    const sorted = [...xs].sort((a, b) => by(b) - by(a));
    return sorted.slice(0, 3).map(tell).join(', ') + (xs.length > 3 ? ` +${xs.length - 3}` : '');
  };
  const ratios = f.reaches.map((m) => m.ratio);
  const lines = [
    `flow over the tasks, ${f.from.toFixed(1)}–${f.to.toFixed(1)} s (advisory, but the gaze lead)`,
    `  gaze lead (≥ ${GAZE_LEAD} s)  ${f.gaze.length ? `${f.gaze.length} takes, shortest ${worst(f.gaze, (g) => -g.lead, (g) => `${num(g.lead)} ${g.side} ${s(g.t)}`)}` : 'no hand took hold'}`,
    `  dead time (≤ 0.3 s)  ${f.dead.length ? worst(f.dead, (d) => d.to - d.from, (d) => `${(d.to - d.from).toFixed(2)} s ${s(d.from)} [${beatAt(r.beats, d.from) || '—'}]`) : 'none'}`,
    `  reaches  ${ratios.length ? `${ratios.length}, peak/mean speed ${num(Math.min(...ratios))}–${num(Math.max(...ratios))} (min-jerk ${BELL.ideal}; ${BELL.low}–${BELL.high})` : 'none'}`,
    `  waypoint halts ${f.halts.length} · mirrored hands ${f.mirrored.length} · stop–start walks ${f.stopStarts.length} · arrival stalls (≤ 0.3 s) ${f.arrivals.length ? worst(f.arrivals, (a) => a.stall, (a) => `${a.stall.toFixed(2)} s ${s(a.t)}`) : 'none'}`,
  ];
  // (the advisory metrics off their mark, with their fixes)
  for (const c of r.checks.filter((c) => c.advisory && failed(c)).sort((a, b) => excess(b) - excess(a))) lines.push(`  ! ${line(c, r.beats)}`, `      fix: ${c.fix}`);
  return lines;
}

/** each variation in a line: its failures' worst */
function variationLines(runs: Run[]): string[] {
  if (!runs.length) return [];
  const fails = runs.map((r) => r.checks.filter((c) => failed(c) && !c.advisory).sort((a, b) => excess(b) - excess(a)));
  const failing = fails.filter((f) => f.length).length;
  return [
    `variations ${failing ? `FAIL ${failing} of ${runs.length}` : `PASS ${runs.length}`} (seeded: the actors' start ±10 cm, ±0.15 rad, ±4% height)`,
    ...fails.map((f, i) => `  #${i + 1} ${f.length ? `FAIL ${f.length}: ${line(f[0], runs[i].beats)}` : 'PASS'}`),
  ];
}

/** what a check is called across runs */
const key = (run: number, c: Check) => `${run}|${c.what}|${c.bound}|${c.where ?? ''}`;

/** writes the runs to .judge/<id>.json and tells what changed since the last time */
function save(id: string, runs: Run[]): string[] {
  const file = `.judge/${id}.json`;
  const now = runs.map((r) => ({ checks: r.checks.map((c) => ({ ...c, failed: failed(c) })), flow: r.flow, beats: r.beats.filter((b) => b.task !== 'idle').map((b) => ({ ...b, label: label(b) })) }));
  const before: typeof now | null = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).runs : null;
  const changes: string[] = [];
  if (before) {
    const old = new Map(before.flatMap((r, i) => r.checks.map((c) => [key(i, c), c] as const)));
    now.forEach((r, i) =>
      r.checks.forEach((c) => {
        const o = old.get(key(i, c));
        const run = i ? ` (#${i})` : '';
        if (!o) return;
        if (o.failed !== c.failed) changes.push(`${c.failed ? '✗ now fails' : '✓ now passes'}${run}: ${c.what} ${num(o.value)} → ${num(c.value)}`);
        else if ((c.failed || c.advisory) && Math.abs(c.value - o.value) > 0.1 * Math.max(Math.abs(o.value), 1e-3)) changes.push(`~ ${c.what}${run}: ${num(o.value)} → ${num(c.value)}`);
      }),
    );
  }
  mkdirSync('.judge', { recursive: true });
  writeFileSync(file, JSON.stringify({ id, runs: now, changes }, (_, v) => (v === -Infinity ? null : v), 1));
  return [`${file} written; ${before ? (changes.length ? `since the last run:\n  ${changes.slice(0, 8).join('\n  ')}${changes.length > 8 ? `\n  … ${changes.length - 8} more` : ''}` : 'nothing changed since the last run') : 'first run'}`];
}

/** the moments worth a look: the beats setting off, the worst failures, the flow's worst, the end; with what to ask of each */
function events(r: Run): Event[] {
  const out: Event[] = [];
  const add = (t: number, why: string, ...questions: string[]) => {
    const near = out.find((e) => Math.abs(e.t - t) < 0.4);
    if (near) {
      near.why += `; ${why}`;
      near.questions.push(...questions.filter((q) => !near.questions.includes(q)));
    } else out.push({ t: Math.min(Math.max(t, 0.05), r.scenario.duration - 0.05), why, questions: [...questions] });
  };
  const fails = r.checks.filter((c) => failed(c) && c.at !== undefined).sort((a, b) => Number(!!a.advisory) - Number(!!b.advisory) || excess(b) - excess(a));
  for (const c of fails.slice(0, 3)) add(c.at ?? 0, `${c.advisory ? 'advisory' : 'failed'}: ${c.what}`, `Does this frame show the problem "${c.what}" (${num(c.value)}, limit ${num(c.limit)})?`);
  const worstDead = r.flow.dead.reduce<{ from: number; to: number } | null>((w, d) => (!w || d.to - d.from > w.to - w.from ? d : w), null);
  if (worstDead) add((worstDead.from + worstDead.to) / 2, 'dead time', 'Is the body standing frozen, waiting, rather than already turning, looking or reaching toward what comes next?');
  for (const g of r.flow.gaze) if (g.lead < GAZE_LEAD) add(g.t - 0.3, `the ${g.side} hand closing, the eyes late`, `Are the eyes on what the ${g.side} hand is about to take, before it gets there?`);
  const starts = r.beats.filter((b) => b.task !== 'idle' && b.task !== 'lookAt' && b.task !== 'ask').sort((a, b) => a.start - b.start);
  for (const b of starts) {
    if (out.length >= 8) break;
    add(b.start + 0.3, `${label(b)} sets off`, ...QUESTIONS[b.task] ?? [], 'Is anything floating, sinking into the floor or passing through the body or the furniture?');
  }
  add(r.scenario.duration - 0.1, 'the end', `Does the scene end as described: "${r.scenario.description ?? r.scenario.title}"?`, 'Does the body stand at rest naturally (weight over both feet, arms relaxed)?');
  return out.sort((a, b) => a.t - b.t).slice(0, 10);
}

/** what to ask a frame early in each task */
const QUESTIONS: Record<string, string[]> = {
  walkTo: ['Does the head turn toward where the body is going before the body turns?'],
  grab: ['Are the eyes on what the hands go for?', 'Does one hand lead rather than both moving as mirror images?'],
  reachFor: ['Are the eyes on what the hands go for?'],
  carry: ['Is the item held firmly in the hands, moving along a smooth arc rather than a straight robotic line?'],
  hold: ['Is the item held firmly in the hands?'],
  release: ['Does the item rest on its support (not floating above it, not sunk into it) as the hands come off?', 'Are the eyes already on what comes next?'],
  wear: ['Does the item sit where it is worn, not through the body?'],
  withGaze: ['Are the eyes on what the task is about?'],
  handTo: ['Does the hand move toward something meaningful, the eyes leading it?'],
  headTo: ['Does the body follow the head naturally (no twisted spine, no lean past the feet)?'],
};

/** a number short: three significant figures, never in exponent form */
function num(v: number): string {
  if (v === -Infinity) return 'never';
  if (v === 0 || Math.abs(v) >= 100) return v.toFixed(0);
  return Number(v.toPrecision(3)).toString();
}
