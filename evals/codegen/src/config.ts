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
 * EVERY knob, in one file — the same rule `evals/ballerina/src/config.ts` keeps.
 *
 * A value here is one you would change to re-point or re-tune the harness:
 * where things live, how long each phase may take, which model plays which
 * part, what the walker may run, where the bands sit. Behaviour is not here.
 *
 * Precedence: a CLI flag beats an env var beats the default. Env vars exist so
 * a sweep can be scripted without threading flags through `make eval-codegen`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { agentBrowserBinDir } from "@aep/playground/src/engine/agent-browser.js";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");

export const PATHS = {
  repoRoot: REPO_ROOT,
  packageRoot: PACKAGE_ROOT,
  /** Committed cases: one directory per case, `case.yaml` + `checklist.yaml` + `specs/` + `issues/`. */
  casesDir: join(PACKAGE_ROOT, "cases"),
  /** The run matrix — `{id, runtime, model}` entries; the first is the default. */
  configsFile: join(PACKAGE_ROOT, "configs.yaml"),
  /** Sweep archives, gitignored. One directory per sweep, named by its id. */
  runsDir: join(PACKAGE_ROOT, ".runs"),
  /** The playground package — `play` is run out of it, see `play.ts`. */
  playgroundDir: join(REPO_ROOT, "playground"),
  /**
   * The ONE credential file. Parsed with `util.parseEnv` for one key
   * (`credentials.ts`); never loaded into this process's environment.
   */
  envFile: join(REPO_ROOT, "deployments", ".env"),
  /**
   * Where an attempt's project is staged. UNDER $HOME because Colima shares
   * only $HOME with its VM: a project under `$TMPDIR` mounts EMPTY in the
   * runner container, and the coding run would build nothing and say so
   * nowhere. OUTSIDE the repo because the coding agent reads its whole
   * project, and a project inside `evals/codegen/` would sit beside the very
   * checklists it is scored against.
   */
  stageRoot: envString("CODEGEN_EVAL_STAGE_ROOT", join(homedir(), ".aep-evals", "codegen")),
} as const;

/** What `save` reads off a playground project. */
export const SAVE = {
  /** A case is these two directories and nothing else (decision 1: from-scratch generation). */
  caseDirs: ["specs", "issues"],
  /**
   * Headings only an agent writes into an issue file. One of them in any issue
   * means the tree is post-run, whatever its top level looks like — `play undo`
   * restores the directories, and a hand-copied project can carry them too.
   */
  agentWrittenSections: [/^## Progress\s*$/m, /^## Mock verification\s*$/m],
  /**
   * A case name becomes part of a staged directory name, which becomes the
   * compose project `aep-wire-<slug>` and the container names under it. Short
   * and kebab keeps all of those legal.
   */
  namePattern: /^[a-z0-9][a-z0-9-]{1,30}$/,
} as const;

/** What an attempt's archive keeps of the generated project (`excludedFromProject` in attempt.ts). */
export const ARCHIVE = {
  /**
   * Build output, dropped where it sits directly in a component's App Path:
   * what the stacks' own toolchains regenerate from the sources beside it.
   * Ballerina's `target/` (`bal build`: the jar and its caches, 163 of a
   * project's ~170 MB) and the React webapp's `dist/` (`vite build`). A
   * root-cause pass reads sources, and at many cases × repeats the output is
   * nearly the whole archive. Only at an App Path's root, so a source directory
   * that shares a name deeper in a tree is kept. `build/` is not listed: no
   * stack here emits it, and a Go layout keeps packaging sources there.
   */
  buildOutputDirs: ["target", "dist"],
} as const;

export const DEFAULTS = {
  /** Attempts per case × config. One shows a case runs; three is the floor for believing a delta. */
  repeats: envInt("CODEGEN_EVAL_REPEATS", 1),
  /**
   * Attempts in flight. ONE by default, unlike the ballerina sweep: an attempt
   * here is a coding container, a compose project and a browser, and two at once
   * on a laptop measure the laptop.
   */
  concurrency: envInt("CODEGEN_EVAL_CONCURRENCY", 1),
} as const;

/** Per-phase ceilings. Every one ends in the same teardown, never an orphan. */
export const TIMEOUTS = {
  /** `play code`. A realistic two-component project runs 30-60 minutes. A case's `timeoutMinutes` overrides it. */
  codingMinutes: envInt("CODEGEN_EVAL_CODING_TIMEOUT_MINUTES", 90),
  /** SIGTERM → this → SIGKILL, for every `play` child. The coding run copies transcripts out on SIGTERM. */
  killGraceSeconds: 60,
  /** `play wire` until `READY <url>`. Compose builds every image cold, so minutes, not seconds. */
  wireReadyMinutes: envInt("CODEGEN_EVAL_WIRE_TIMEOUT_MINUTES", 20),
  /** SIGTERM to `STOPPED`/exit before the harness takes the compose project down itself. */
  wireStopMinutes: 2,
  /** The walk's wall clock. */
  walkMinutes: envInt("CODEGEN_EVAL_WALK_TIMEOUT_MINUTES", 30),
  /** The planner and the judge: one structured answer each. */
  plannerMinutes: 15,
  judgeMinutes: 10,
} as const;

/**
 * The models of the harness's OWN agents. Not the model under test — that is a
 * `configs.yaml` entry. Pinned rather than left to the SDK's default, which
 * drifts across releases: a judge that changes model between two sweeps makes
 * their delta unreadable.
 */
export const MODELS = {
  planner: envString("CODEGEN_EVAL_PLANNER_MODEL", "claude-sonnet-5-5"),
  walker: envString("CODEGEN_EVAL_WALKER_MODEL", "claude-sonnet-5-5"),
  judge: envString("CODEGEN_EVAL_JUDGE_MODEL", "claude-sonnet-5-5"),
} as const;

export const PLANNER = {
  /** Read-only: the planner reads a case, it never edits one. */
  tools: ["Read", "Glob", "Grep"],
  maxTurns: 60,
  /** Structured output that fails the schema is retried once, then refused. */
  attempts: 2,
} as const;

export const WALKER = {
  /** Bash is `agent-browser` only and Read/Write stay in `walk/` — `walker.ts`'s guard enforces both. */
  tools: ["Bash", "Read", "Write"],
  /**
   * The walker's `agent-browser`: this package's devDependency, put first on
   * the walk's PATH. Pinned to the runner image's version (a test holds the two
   * equal) because a walker on another version measures a different tool —
   * see `@aep/playground/src/engine/agent-browser.ts`.
   */
  binDir: agentBrowserBinDir(PACKAGE_ROOT),
  /**
   * The section of the platform's agent-browser skill the walker prompt
   * embeds, by its exact heading: the coding run's walk and this one confirm
   * an action by the same text. Read at prompt-build time, refused at startup
   * when the heading is gone.
   */
  confirmSection: { file: join(REPO_ROOT, "skills", "agent-browser", "SKILL.md"), heading: "## Confirm each action" },
  maxTurns: envInt("CODEGEN_EVAL_WALK_MAX_TURNS", 400),
  /**
   * `agent-browser` commands that may run to their timeout IN A ROW before the
   * browser is declared unresponsive and the walk stops as a harness error
   * (`BrowserWatchdog`). Three: one is a slow page and two a slow page retried,
   * but three with nothing completing between them is a browser that no longer
   * answers — measured once at six, each 30-120 s, after which the walker
   * marked every remaining item failed. At the walker's usual 120 s timeout
   * that ends a dead walk in about six minutes rather than thirty.
   */
  unresponsiveAfter: 3,
  /**
   * Shell metacharacters a walker command may not contain. With these gone a
   * command is one `agent-browser` invocation and nothing else: no chaining,
   * no substitution, no redirect to a file the guard never saw.
   */
  forbiddenShell: [";", "&", "|", "$(", "`", ">", "<", "\n"],
  /**
   * `agent-browser` verbs a walk has no business with, matched on the FIRST
   * argument (where a verb sits) so text typed into a field cannot trip them.
   * `chat` is a second model; `eval` runs script in the page, which is reading
   * or changing the app from behind it rather than using it, and so does
   * `webmcp` (0.36+), which calls tools the page registers instead of its UI;
   * the rest reach outside one isolated, headless browser session. A `batch`
   * is checked command by command against the same lists.
   */
  forbiddenVerbs: ["chat", "eval", "webmcp", "connect", "auth", "install", "upgrade", "dashboard", "stream", "inspect"],
  /**
   * `network route`/`unroute` would let the walker answer the app's own
   * requests — the one workaround that makes every item pass.
   */
  forbiddenSubcommands: { network: ["route", "unroute"] } as Record<string, string[]>,
  /**
   * Flags refused anywhere on the line. `--all` is `close --all`, which closes
   * EVERY session on the machine, someone else's included; the session and
   * profile flags would leave the attempt's own isolated session.
   */
  forbiddenFlags: [
    "--all",
    "--session",
    "--session-name",
    "--profile",
    "--state",
    "--cdp",
    "--auto-connect",
    "--provider",
    "--headed",
    "--allow-file-access",
    "--allowed-domains",
  ],
  /** Navigation is held to the app on this machine (`--allowed-domains`, via its env var). */
  allowedDomains: "localhost,127.0.0.1",
} as const;

export const JUDGE = {
  /** No tools: the judge reads the evidence it is handed, nothing else. */
  tools: [] as string[],
  attempts: 2,
} as const;

/** What every attempt records about the tree it ran against (`provenance.ts`). */
export const PROVENANCE = {
  /**
   * Uncommitted paths under these roots are listed in `provenance.json`: the
   * coding run reads `skills/` and the runner's `local.ts` from the working
   * tree, `wire` is the playground's, and the harness is this package — an
   * edit in any of them changes what an attempt measured.
   */
  dirtyRoots: ["skills/", "runners/remote-worker/", "playground/", "evals/codegen/"],
  /** `skills.diff` covers this root — the part a skill edit loop changes between sweeps. */
  diffRoot: "skills/",
} as const;

/** Verdict bands, on a 0..100 score — the spec-agents evals' (`evals/spec-agents/src/scoring/bands.ts`). */
export const BANDS = {
  pass: 75,
  review: 50,
} as const;

/**
 * The `AEP_MODEL_*` names a coding run reads as a model connection — the
 * playground's `CODING_CONNECTION_ENV` (`playground/src/kit/model-connection.ts`)
 * plus `AEP_MODEL_CONTEXT_WINDOW`. Copied, not imported: that module loads
 * `@aep/agents`, whose module scope merges `deployments/.env` into
 * `process.env`, and this process must never hold that file's API key.
 */
export const CONNECTION_ENV = [
  "AEP_MODEL_FORMAT",
  "AEP_MODEL_BASE_URL",
  "AEP_MODEL_AUTH_SCHEME",
  "AEP_MODEL_API_KEY",
  "AEP_MODEL_WEB_SEARCH",
  "AEP_MODEL_CONTEXT_WINDOW",
] as const;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  // A malformed value falls back rather than becoming NaN or 0, as in evals/ballerina.
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function envString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}
