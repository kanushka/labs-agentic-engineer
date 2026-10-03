/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * One attempt: stage → code → wire → walk → stop → judge → archive. And its
 * cheap sibling, the REWALK: stage an archived attempt's generated project →
 * wire → walk → stop → judge → archive, against the CURRENT checklist — the
 * loop for tuning a checklist or the walker without paying for a coding run.
 * Both run the same phase functions below; they differ only in how the staged
 * project comes to exist.
 *
 * Every phase is timed, and every way it can end is CLASSIFIED, because the
 * report's whole value rests on telling three things apart (decision 8):
 *
 *   scored        — the app came up and was walked; the score is the judge's.
 *   hard-fail     — the CODE failed: the coding run did not succeed or built
 *                   nothing, or `wire` would not bring it up. Score 0, counted.
 *   harness-error — something that is not the code: docker down, a refused
 *                   credential, a walker or judge that produced no answer, an
 *                   interrupt, a crash in here. Counted, never averaged in.
 *
 * Teardown is unconditional and runs in `finally`: a `play` child left alive
 * is a compose project and a container still running when the next attempt
 * starts on the same ports.
 *
 * The archive keeps EVERYTHING a later root-cause stage could want (decision
 * 6) — the generated project, the coding transcripts, the walk with its
 * screenshots, the wire logs — minus dependencies and the session's secrets.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { readWireSession } from "@aep/playground/src/engine/wire/state.js";
import { killListener } from "@aep/playground/src/engine/wire/runtime.js";
import { projectSlug } from "@aep/playground/src/ports/spec-workspace.js";
import { scoredItems, type EvalCase, type RunConfig } from "./case.js";
import { PATHS, SAVE, TIMEOUTS } from "./config.js";
import { CredentialError, playEnv, sdkEnv } from "./credentials.js";
import { judge } from "./judge.js";
import { countEvents, lastResultCost, readRunSettled, type Tokens } from "./metrics.js";
import { baseUrl, composeDown, composeLogsTo, isStopped, parseReady, removeContainer, startPlay, waitForLine, type PlayProcess } from "./play.js";
import { scoreAttempt, type Band } from "./score.js";
import { writeProvenance } from "./provenance.js";
import { normalizeWalk, walk } from "./walker.js";

export type AttemptStatus = "scored" | "hard-fail" | "harness-error";
export type Phase = "stage" | "code" | "wire" | "walk" | "stop" | "judge" | "archive";

interface SessionCost {
  costUsd: number | null;
  tokens: Tokens;
  turns: number;
}

/** One attempt's full record — `attempt.json`, and the row every report is built from. */
export interface AttemptRecord {
  /**
   * `rewalk` records re-walk an archived attempt's code against the current
   * checklist; they never enter a sweep's statistics. Absent in records
   * written before rewalks existed, which are attempts.
   */
  kind?: "attempt" | "rewalk";
  /** A rewalk's number under its attempt (`rewalk-<n>/`). */
  rewalk?: number;
  sweepId: string;
  case: string;
  config: string;
  attempt: number;
  status: AttemptStatus;
  /** 0..100 when scored, 0 on a hard fail, null on a harness error. */
  score: number | null;
  band: Band | null;
  /** A mustNot capped the band. */
  capped: boolean;
  /** Why a hard fail or harness error happened, in one line. */
  symptom?: string;
  failing: { id: string; weight: number; symptom: string }[];
  violated: string[];
  /** Wall clock per phase reached, milliseconds. */
  phases: Partial<Record<Phase, number>>;
  coding: { outcome: string | null; minutes: number | null; costUsd: number | null; tokens: Tokens | null };
  walk: SessionCost | null;
  judge: SessionCost | null;
  /** Where everything is, relative to the repo root. */
  archive: string;
}

/** The code failed — score 0, counted. */
class HardFail extends Error {}
/** Not the code's failure — counted, excluded from the statistics. */
class HarnessError extends Error {}

/** What every run needs, attempt or rewalk alike. */
export interface RunTarget {
  evalCase: EvalCase;
  config: RunConfig;
  /** `wire`'s role names for this case (`caseRoles`). */
  roles: string[];
  token: string;
  /** `deployments/.env`, parsed — only an opencode connection's key is read from it. */
  dotenv: Record<string, string | undefined>;
  keep: boolean;
  signal: AbortSignal;
  say: (line: string) => void;
}

export interface AttemptContext extends RunTarget {
  sweepId: string;
  attempt: number;
}

export interface RewalkContext extends RunTarget {
  /** The archived attempt directory (`.runs/<sweep>/<case>/<config>/attempt-<n>`), absolute. */
  attemptDir: string;
  /** The parent attempt's record — its sweep, case, config and number. */
  parent: AttemptRecord;
}

/** One run in flight: its record, its directories, and the children it must take down. */
interface Run {
  label: string;
  record: AttemptRecord;
  archive: string;
  stage: string;
  live: { code?: PlayProcess; wire?: PlayProcess };
  codingRunDir: string | null;
  codeKilled: boolean;
  /** A rewalk's project is its parent's; only an attempt archives one. */
  archiveProject: boolean;
  target: RunTarget;
}

export function attemptDirs(sweepId: string, caseName: string, configId: string, attempt: number): { archive: string; stage: string } {
  return {
    archive: join(PATHS.runsDir, sweepId, caseName, configId, `attempt-${String(attempt)}`),
    // Short and flat: its basename becomes the compose project `aep-wire-<slug>`.
    stage: join(PATHS.stageRoot, sweepId, `${caseName}-${configId}-${String(attempt)}`),
  };
}

/** The next free `rewalk-<n>` under an archived attempt, and where to stage it. */
export function rewalkDirs(attemptDir: string, parent: AttemptRecord): { archive: string; stage: string; n: number } {
  const taken = existsSync(attemptDir)
    ? readdirSync(attemptDir)
        .map((name) => /^rewalk-(\d+)$/.exec(name)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number)
    : [];
  const n = Math.max(0, ...taken) + 1;
  return {
    n,
    archive: join(attemptDir, `rewalk-${String(n)}`),
    stage: join(PATHS.stageRoot, "rewalk", `${parent.case}-${parent.config}-${String(parent.attempt)}r${String(n)}`),
  };
}

function newRecord(fields: Pick<AttemptRecord, "sweepId" | "case" | "config" | "attempt" | "archive"> & Partial<AttemptRecord>): AttemptRecord {
  return {
    kind: "attempt",
    status: "harness-error",
    score: null,
    band: null,
    capped: false,
    failing: [],
    violated: [],
    phases: {},
    coding: { outcome: null, minutes: null, costUsd: null, tokens: null },
    walk: null,
    judge: null,
    ...fields,
  };
}

export async function runAttempt(ctx: AttemptContext): Promise<AttemptRecord> {
  const { archive, stage } = attemptDirs(ctx.sweepId, ctx.evalCase.name, ctx.config.id, ctx.attempt);
  const run: Run = {
    label: `${ctx.evalCase.name} × ${ctx.config.id} #${String(ctx.attempt)}`,
    record: newRecord({
      sweepId: ctx.sweepId,
      case: ctx.evalCase.name,
      config: ctx.config.id,
      attempt: ctx.attempt,
      archive: relative(PATHS.repoRoot, archive),
    }),
    archive,
    stage,
    live: {},
    codingRunDir: null,
    codeKilled: false,
    archiveProject: true,
    target: ctx,
  };
  return execute(run, async (env) => {
    await timed(run, "stage", async () => {
      rmSync(stage, { recursive: true, force: true });
      mkdirSync(stage, { recursive: true });
      for (const name of SAVE.caseDirs) cpSync(join(ctx.evalCase.dir, name), join(stage, name), { recursive: true });
    });
    interrupted(run);
    await codePhase(run, env);
  });
}

/**
 * Re-walk an archived attempt's code. The staged project is the archive's
 * `project/` minus the wire state — `wire` regenerates its plan, keys and
 * tokens, and a stale `session.json` would name a pid that may since belong to
 * another process. Dependencies were never archived, so `wire` reinstalls the
 * app's on this host, exactly as it does after a docker coding run.
 */
export async function runRewalk(ctx: RewalkContext): Promise<AttemptRecord> {
  const { archive, stage, n } = rewalkDirs(ctx.attemptDir, ctx.parent);
  const run: Run = {
    label: `${ctx.parent.case} × ${ctx.parent.config} #${String(ctx.parent.attempt)} rewalk-${String(n)}`,
    record: newRecord({
      kind: "rewalk",
      rewalk: n,
      sweepId: ctx.parent.sweepId,
      case: ctx.parent.case,
      config: ctx.parent.config,
      attempt: ctx.parent.attempt,
      // The code is the parent's, so its coding facts are too.
      coding: ctx.parent.coding,
      archive: relative(PATHS.repoRoot, archive),
    }),
    archive,
    stage,
    live: {},
    codingRunDir: null,
    codeKilled: false,
    archiveProject: false,
    target: ctx,
  };
  return execute(run, async () => {
    await timed(run, "stage", async () => {
      const project = join(ctx.attemptDir, "project");
      if (!existsSync(project)) throw new HarnessError(`${project} does not exist — nothing to rewalk`);
      rmSync(stage, { recursive: true, force: true });
      mkdirSync(stage, { recursive: true });
      cpSync(project, stage, { recursive: true, verbatimSymlinks: true });
      rmSync(join(stage, ".aep-playground", "wire"), { recursive: true, force: true });
    });
    interrupted(run);
  });
}

/**
 * The shared body: `prepare` brings the staged project into existence, then
 * wire → walk → stop → judge, every failure classified, teardown and archive
 * always.
 */
async function execute(run: Run, prepare: (env: NodeJS.ProcessEnv) => Promise<void>): Promise<AttemptRecord> {
  const { target, record } = run;
  for (const dir of ["coding", "wire", join("walk", "shots"), "judge"]) {
    if (dir === "coding" && !run.archiveProject) continue;
    mkdirSync(join(run.archive, dir), { recursive: true });
  }
  // The sweep's SIGINT reaches a phase that is waiting on a child through
  // the child: stopping it resolves whatever is awaiting its exit.
  const onAbort = (): void => {
    void run.live.code?.stop(TIMEOUTS.killGraceSeconds * 1000);
    void run.live.wire?.stop(TIMEOUTS.wireStopMinutes * 60_000);
  };
  target.signal.addEventListener("abort", onAbort, { once: true });

  try {
    // First, before anything can change underneath it: what this run ran against.
    writeProvenance(run.archive, target.config);
    // The checklist this attempt is scored against, as it stood. The case's own
    // file is hand-edited and replanned freely, so after a change the archive is
    // the only place that still says what an old score meant.
    cpSync(join(target.evalCase.dir, "checklist.yaml"), join(run.archive, "checklist.yaml"));
    let env: NodeJS.ProcessEnv;
    try {
      env = playEnv(process.env, target.token, target.config, target.dotenv);
    } catch (e) {
      throw new HarnessError(e instanceof Error ? e.message : String(e));
    }
    await prepare(env);
    await servePhases(run, env);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof HardFail) {
      Object.assign(record, { status: "hard-fail" as const, score: 0, band: "fail" as const, symptom: message });
    } else {
      // CredentialError, HarnessError, and anything unexpected: none of them is the code's.
      record.status = "harness-error";
      record.symptom = e instanceof CredentialError || e instanceof HarnessError ? message : `harness crash: ${message}`;
    }
  } finally {
    target.signal.removeEventListener("abort", onAbort);
    await finalize(run);
  }
  return record;
}

async function timed<T>(run: Run, phase: Phase, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  // Labelled: at --concurrency > 1 these lines interleave across attempts.
  run.target.say(`    · ${run.label} · ${phase}`);
  try {
    return await fn();
  } finally {
    run.record.phases[phase] = Date.now() - started;
  }
}

function interrupted(run: Run): void {
  if (run.target.signal.aborted) throw new HarnessError("interrupted");
}

async function codePhase(run: Run, env: NodeJS.ProcessEnv): Promise<void> {
  const { record, stage, target } = run;
  await timed(run, "code", async () => {
    const play = startPlay([stage, "code", "--yes"], { env, logFile: join(run.archive, "coding", "play.log") });
    run.live.code = play;
    const limitMs = (target.evalCase.meta.timeoutMinutes ?? TIMEOUTS.codingMinutes) * 60_000;
    let stopping: Promise<"exited" | "killed"> | undefined;
    const timer = setTimeout(() => {
      stopping = play.stop(TIMEOUTS.killGraceSeconds * 1000);
    }, limitMs);
    const exit = await play.exited;
    clearTimeout(timer);
    const timedOut = stopping !== undefined;
    if (stopping) run.codeKilled = (await stopping) === "killed";
    delete run.live.code;
    run.codingRunDir = newestCodingRun(stage);
    interrupted(run);

    const progress = run.codingRunDir ? readText(join(run.codingRunDir, "progress.ndjson")) : "";
    const settled = readRunSettled(progress);
    record.coding.outcome = settled?.outcome ?? null;
    record.coding.tokens = settled?.tokens ?? null;
    record.coding.costUsd = run.codingRunDir ? lastResultCost(readText(join(run.codingRunDir, ".logs", "runtime.log"))) : null;

    if (timedOut) throw new HardFail(`coding run timed out after ${String(limitMs / 60_000)} min`);
    if (countEvents(progress) === 0) {
      // Nothing reached the feed: the run never started. That is docker, the
      // runner image or the credential — `play` says which in its last lines.
      throw new HarnessError(`the coding run never started (exit ${String(exit.code)}): ${lastLines(play)}`);
    }
    if (!settled) throw new HardFail(`the coding run ended without settling (exit ${String(exit.code)})`);
    if (settled.outcome !== "success") throw new HardFail(`coding run outcome: ${settled.outcome}`);
    if (!builtAnything(stage)) throw new HardFail("the coding run produced no component directory");
  });
  interrupted(run);
}

/** wire → walk → stop → judge → score: everything after the project exists. */
async function servePhases(run: Run, env: NodeJS.ProcessEnv): Promise<void> {
  const { record, stage, target } = run;
  const url = await timed(run, "wire", async () => {
    const firstRole = target.roles[0] ?? "";
    const play = startPlay([stage, "wire", "--yes", "--fresh", "--no-open", "--no-triage", "--role", firstRole], {
      env,
      logFile: join(run.archive, "wire", "wire.log"),
    });
    run.live.wire = play;
    const ready = await waitForLine(play, parseReady, TIMEOUTS.wireReadyMinutes * 60_000);
    interrupted(run);
    if (ready.kind === "line") return baseUrl(ready.value);
    if (ready.kind === "timeout") throw new HardFail(`unwireable: no READY within ${String(TIMEOUTS.wireReadyMinutes)} min — ${lastLines(play)}`);
    // `wire`'s preflight names what is missing on this machine; that is the harness's environment, not the code.
    if (play.tail(50).some((line) => line.includes("not available:"))) throw new HarnessError(`wire preflight: ${lastLines(play)}`);
    throw new HardFail(`unwireable: ${lastLines(play)}`);
  });

  const items = scoredItems(target.evalCase.checklist);
  const walkDir = join(run.archive, "walk");
  const walked = await timed(run, "walk", () =>
    walk({
      baseUrl: url,
      roles: target.roles,
      items,
      mustNot: target.evalCase.checklist.extras.mustNot,
      walkDir,
      sessionName: `eval-${projectSlug(stage)}`,
      env: sdkEnv(process.env, target.token),
      signal: target.signal,
    }),
  );
  record.walk = { costUsd: walked.costUsd, tokens: walked.tokens, turns: walked.numTurns };
  if (walked.credentialRefused) throw new HarnessError(walked.error ?? "walker credential refused");
  interrupted(run);
  if (!walked.output) throw new HarnessError(`the walk produced no result: ${walked.error ?? "unknown"}`);
  const walkResult = normalizeWalk(items, walked.output);
  writeFileSync(join(walkDir, "result.json"), JSON.stringify(walkResult, null, 2));

  await timed(run, "stop", () => stopWire(run));

  const verdict = await timed(run, "judge", () =>
    judge({
      items,
      mustNot: target.evalCase.checklist.extras.mustNot,
      walk: walkResult,
      cwd: join(run.archive, "judge"),
      env: sdkEnv(process.env, target.token),
      transcriptFile: join(run.archive, "judge", "transcript.jsonl"),
      signal: target.signal,
    }),
  );
  record.judge = { costUsd: verdict.costUsd, tokens: verdict.tokens, turns: verdict.numTurns };
  interrupted(run);
  if (!verdict.output) throw new HarnessError(`the judge produced no verdict: ${verdict.error ?? "unknown"}`);
  writeFileSync(join(run.archive, "judge", "verdict.json"), JSON.stringify(verdict.output, null, 2));

  const score = scoreAttempt(items, verdict.output, new Map(walkResult.items.map((entry) => [entry.id, entry.verdict])));
  Object.assign(record, {
    status: "scored" as const,
    score: score.score,
    band: score.band,
    capped: score.capped,
    failing: score.failing,
    violated: score.violated,
  });
}

/** Teardown, archive, records, and the staged directory — whichever way the run ended. */
async function finalize(run: Run): Promise<void> {
  const { record, stage } = run;
  // The code phase's own wall clock, whichever way it ended.
  if (record.phases.code !== undefined) record.coding.minutes = round(record.phases.code / 60_000);
  if (run.live.code) {
    run.codeKilled = (await run.live.code.stop(TIMEOUTS.killGraceSeconds * 1000)) === "killed" || run.codeKilled;
    delete run.live.code;
    run.codingRunDir ??= newestCodingRun(stage);
  }
  // A SIGKILLed `play code` could not remove its own container.
  if (run.codeKilled && run.codingRunDir) await removeContainer(`aep-play-${basename(run.codingRunDir).replace(/-code$/, "")}`);
  await stopWire(run);
  const started = Date.now();
  try {
    archiveRun(run);
  } catch (e) {
    record.symptom = `${record.symptom ? `${record.symptom}; ` : ""}archive incomplete: ${e instanceof Error ? e.message : String(e)}`;
  }
  record.phases.archive = Date.now() - started;
  writeFileSync(join(run.archive, "metrics.json"), JSON.stringify({ coding: record.coding, walk: record.walk, judge: record.judge }, null, 2));
  writeFileSync(join(run.archive, "attempt.json"), JSON.stringify(record, null, 2));
  if (!run.target.keep) {
    try {
      rmSync(stage, { recursive: true, force: true });
    } catch (e) {
      // A file the container wrote with other ownership; the record already stands.
      run.target.say(`    ! could not remove ${stage}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Take a wired session down: capture the services' logs, SIGTERM and wait for
 * `STOPPED` (or exit), SIGKILL past the deadline. Then ALWAYS `compose down -v` by project name: `wire`
 * keeps its database volume on purpose, so a person's rows survive to their
 * next session, but an attempt is throwaway and a kept volume is a leak — one
 * per attempt, forever (measured: the first live sweep left one behind). The
 * dev server is reaped by the port `session.json` recorded only when `wire`
 * could not do it itself.
 */
async function stopWire(run: Run): Promise<void> {
  const play = run.live.wire;
  if (!play) return;
  delete run.live.wire;
  const project = `aep-wire-${projectSlug(run.stage)}`;
  // BEFORE the SIGTERM: `wire`'s teardown removes the containers and their logs
  // with them. On every path that reaches here — the stop phase, and a hard
  // fail where compose came up but READY never printed. A `wire` that already
  // exited took its containers down itself; its wire.log carries the tail it
  // printed on the way out.
  const logs = join(run.archive, "wire", "logs");
  mkdirSync(logs, { recursive: true });
  await composeLogsTo(project, join(logs, "services.log"));
  let sawStopped = false;
  play.onLine((line) => {
    if (isStopped(line)) sawStopped = true;
  });
  const how = await play.stop(TIMEOUTS.wireStopMinutes * 60_000);
  await composeDown(project);
  if (how === "killed" || !sawStopped) {
    const port = readWireSession(run.stage)?.webappPort;
    if (port) await killListener(port);
  }
}

/** The run dir the coding run just wrote: the newest `.aep-playground/runs/*-code`. */
function newestCodingRun(stage: string): string | null {
  const runs = join(stage, ".aep-playground", "runs");
  if (!existsSync(runs)) return null;
  const newest = readdirSync(runs)
    .filter((name) => name.endsWith("-code"))
    .sort()
    .pop();
  return newest ? join(runs, newest) : null;
}

/** Did the run write ANY component's App Path? None means it built nothing at all. */
function builtAnything(stage: string): boolean {
  const components = join(stage, "specs", "design", "components");
  if (!existsSync(components)) return false;
  return readdirSync(components).some((name) => {
    try {
      const design = JSON.parse(readFileSync(join(components, name, "design.json"), "utf8")) as { appPath?: unknown };
      return typeof design.appPath === "string" && existsSync(join(stage, design.appPath));
    } catch {
      return false;
    }
  });
}

/**
 * Paths (relative to the staged project) that stay out of `project/`.
 * `node_modules` anywhere — reinstallable and enormous; the session's
 * secrets, bearers and private key; the undo snapshots (the case already is
 * that state); and the coding run dirs, which `coding/` holds whole. Pure.
 */
export function excludedFromProject(rel: string): boolean {
  if (rel.split(sep).includes("node_modules")) return true;
  const wire = join(".aep-playground", "wire");
  return [
    join(wire, "secrets.json"),
    join(wire, "tokens.json"),
    join(wire, "key.pem"),
    join(".aep-playground", "undo"),
    join(".aep-playground", "runs"),
  ].some((path) => rel === path || rel.startsWith(path + sep));
}

function archiveRun(run: Run): void {
  const { stage, archive } = run;
  if (!existsSync(stage)) return;
  if (run.archiveProject) {
    cpSync(stage, join(archive, "project"), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => !excludedFromProject(relative(stage, src)),
    });
  }
  if (run.codingRunDir && existsSync(run.codingRunDir)) {
    // `bearer` is the run's MCP credential file — empty locally, and never worth keeping.
    cpSync(run.codingRunDir, join(archive, "coding", basename(run.codingRunDir)), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => basename(src) !== "bearer",
    });
  }
  const wire = join(stage, ".aep-playground", "wire");
  for (const name of ["plan.json", "compose.yaml", "logs"]) {
    if (existsSync(join(wire, name))) cpSync(join(wire, name), join(archive, "wire", name), { recursive: true });
  }
}

function lastLines(play: PlayProcess): string {
  return play
    .tail(8)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ⏎ ");
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
