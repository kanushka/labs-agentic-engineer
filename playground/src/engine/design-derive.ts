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
 * THE PLAYGROUND'S PRE-TAG STEP (ADR-0003).
 *
 * Production's POST /build runs a platform-resource derivation before it cuts a
 * tag: it stamps `exposesAPI.auth` from a resource type's role marker and each
 * dependency's `wiring` (ref, env bindings, sibling endpoint) from the type's
 * declared outputs, and commits them into `design.json`. The coding agent reads
 * that wiring as its spec; a platform resource without it is broken input. The
 * playground never builds, so without this step every playground project hands
 * the agent a design production never sends.
 *
 * It is not ported. This module spawns aep-api's own derivation
 * (`services/aep-api/cmd/design-derive`): the same Go assembler, catalog
 * projection, derivation and render, over the repo's resource-type manifests
 * instead of the cluster's API. `go run` caches the built binary, so a rerun
 * costs a process start, not a compile.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT } from "../paths.js";
import { projectSlug } from "../ports/spec-workspace.js";

/** The Go module the derivation lives in; `go run` is invoked from here. */
const AEP_API_DIR = join(REPO_ROOT, "services", "aep-api");

/** The local catalog: the same ClusterResourceTypes the local cluster installs. */
const RESOURCE_TYPES_DIR = join(REPO_ROOT, "deployments", "single-cluster", "resource-types");

/** What one run of the CLI said. `spawnError` is set when the process never started. */
export interface DeriveProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: NodeJS.ErrnoException;
}

/** Runs `design-derive` with these arguments. Injected by tests. */
export type DeriveRunner = (args: string[]) => Promise<DeriveProcessResult>;

export type DeriveOutcome = { ok: true; changed: string[] } | { ok: false; detail: string };

/** `go run ./cmd/design-derive <args>` from the aep-api module. */
const goRun: DeriveRunner = (args) =>
  new Promise((resolve) => {
    const child = spawn("go", ["run", "./cmd/design-derive", ...args], {
      cwd: AEP_API_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => resolve({ code: null, stdout, stderr, spawnError: err }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

/**
 * Derive the project's design in place. The project id is the playground's
 * project slug, the name it uses for the project everywhere else.
 *
 * A refusal (exit 1: an unknown resource type, an auth conflict) carries the
 * derivation's own message, as production's build refusal does. Anything else
 * that is not a clean exit is a failure of the step, and it refuses the run too:
 * running the agent on an underived design is the bug this step removes.
 */
export async function deriveDesign(projectDir: string, runner: DeriveRunner = goRun): Promise<DeriveOutcome> {
  const result = await runner([
    "--design-dir",
    join(projectDir, "specs", "design"),
    "--project",
    projectSlug(projectDir),
    "--resource-types",
    RESOURCE_TYPES_DIR,
  ]);
  if (result.spawnError) {
    const reason =
      result.spawnError.code === "ENOENT"
        ? "`go` is not on PATH. The code run derives each dependency's wiring with aep-api's Go derivation before the agent starts (playground ADR-0003); install Go and re-run"
        : `could not start the design derivation: ${result.spawnError.message}`;
    return { ok: false, detail: reason };
  }
  const message = result.stderr.trim().split("\n").filter(Boolean).pop() ?? "";
  if (result.code === 1) return { ok: false, detail: `design refused: ${message.replace(/^design-derive: /, "")}` };
  if (result.code !== 0) {
    return { ok: false, detail: `design derivation failed (exit ${String(result.code)}): ${result.stderr.trim()}` };
  }
  const changed = result.stdout
    .split("\n")
    .map((line) => /^derived: (.+)$/.exec(line)?.[1])
    .filter((path): path is string => path !== undefined && path !== "no change");
  return { ok: true, changed };
}
