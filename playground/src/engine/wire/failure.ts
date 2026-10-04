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
 * WHOSE FAILURE a bring-up was: the generated app's, or everything around it.
 *
 * `wire` is the one place a generated app meets a real machine, so when it
 * does not come up there are two very different answers, and a reader (a
 * developer, or the codegen eval that scores the app) must not have to guess
 * which from prose:
 *
 *   app          — the project failed: its Dockerfile did not build, its
 *                  service started and then died or never turned healthy, its
 *                  dev server crashed on start, or it lacks a file wired mode
 *                  needs.
 *   environment  — anything else: this machine, docker, the network, a port
 *                  someone else holds, a dependency wired mode cannot stand in
 *                  for, or `wire` itself.
 *
 * Each rule below reads a STRUCTURED signal — a BuildKit vertex, a container's
 * `State`, whether a process exited — never the wording of an error message.
 * The wording rides along as the reason, for a person to read.
 *
 * THE CONTRACT with a driver is one line and one exit code, both defined here:
 * `FAILED <cause> <reason>` on stdout, and `WIRE_EXIT[cause]` as the process
 * status. `READY <url>` (panel.ts) is its success twin.
 */

export type WireCause = "app" | "environment";

export interface WireFailure {
  cause: WireCause;
  /** One line, for a person: what failed, in the failing tool's own words where it has any. */
  reason: string;
}

/** A step that failed and already knows whose failure it was. */
export class WireStepFailed extends Error {
  constructor(readonly failure: WireFailure) {
    super(failure.reason);
  }
}

/** The process status `play <dir> wire` exits with, per cause. 1 stays "failed, unclassified". */
export const WIRE_EXIT: Readonly<Record<WireCause, number>> = { app: 3, environment: 4 };

/**
 * `FAILED <cause> <reason>` — the reason folded onto one line, so the line is
 * the whole record. Its parser is the driver's (`parseFailed` in
 * `evals/codegen/src/play.ts`, beside `parseReady`), and that package's tests
 * round-trip this function's output through it.
 */
export function failedLine(failure: WireFailure): string {
  return `FAILED ${failure.cause} ${oneLine(failure.reason)}`;
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ⏎ ").trim() || "(no reason given)";
}

// --- build ------------------------------------------------------------------

/** One BuildKit vertex as `docker compose --progress json build` reports it. */
interface Vertex {
  digest: string;
  name: string;
  inputs: string[];
  error: string;
  completed: string;
}

/**
 * Why `compose build` failed, from BuildKit's own solve status.
 *
 * `--progress json` makes compose print BuildKit's progress records as JSON
 * lines: `vertexes` (one step of the build graph: name, inputs, and an `error`
 * when it failed) and `logs` (that step's output, base64). The FIRST vertex to
 * fail is the cause; whatever failed after it is the rest of the build being
 * cancelled, which in a multi-service build includes other services' pulls.
 *
 *   failing vertex has inputs  → app. It ran on top of something already
 *     built: a RUN, a COPY, a stage of the project's own Dockerfile.
 *   failing vertex has none    → environment. A source: resolving or pulling a
 *     base image, loading the build context — fetching what the build needs.
 *   no failing vertex at all   → app. BuildKit refused the Dockerfile before
 *     it had a graph (a parse error reports no vertex).
 *
 * Known edges, by design: a RUN that fetches from the network (a package
 * install) and dies of the network reads as the app's, because to BuildKit it
 * is the project's step; a base image tag that does not exist reads as the
 * environment's, because it is a source that did not resolve. Either way the
 * reason quotes BuildKit, so the record says which it actually was.
 */
export function classifyBuild(output: string): WireFailure & { log: string } {
  const vertices = new Map<string, Vertex>();
  const logs = new Map<string, string[]>();
  let message = "";
  for (const record of jsonRecords(output)) {
    for (const raw of array(record.vertexes)) {
      const vertex = raw as Record<string, unknown>;
      const digest = str(vertex.digest);
      if (!digest) continue;
      const known = vertices.get(digest);
      vertices.set(digest, {
        digest,
        name: str(vertex.name) || known?.name || "",
        inputs: array(vertex.inputs).length > 0 ? array(vertex.inputs).map(String) : (known?.inputs ?? []),
        error: str(vertex.error) || known?.error || "",
        completed: str(vertex.completed) || known?.completed || "",
      });
    }
    for (const raw of array(record.logs)) {
      const entry = raw as Record<string, unknown>;
      const digest = str(entry.vertex);
      const data = str(entry.data);
      if (digest && data) logs.set(digest, [...(logs.get(digest) ?? []), Buffer.from(data, "base64").toString("utf8")]);
    }
    if (record.error === true) message = str(record.message);
  }

  const failed = [...vertices.values()]
    .filter((vertex) => vertex.error)
    .sort((a, b) => Date.parse(a.completed || "9999") - Date.parse(b.completed || "9999"))[0];
  if (!failed) {
    return { cause: "app", reason: `the Dockerfile was refused: ${lastSentence(message) || "compose build failed"}`, log: message };
  }
  const log = (logs.get(failed.digest) ?? []).join("");
  if (failed.inputs.length === 0) {
    return { cause: "environment", reason: `fetching a build input failed — ${failed.name}: ${failed.error}`, log };
  }
  return { cause: "app", reason: `a Dockerfile step failed — ${failed.name}: ${failed.error}`, log };
}

/** compose's closing message ends with BuildKit's own line; the rest is the Dockerfile excerpt. */
function lastSentence(message: string): string {
  return (
    message
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ""
  );
}

// --- up ---------------------------------------------------------------------

/** What `docker inspect` says about one container of the project. */
export interface ContainerFacts {
  /** The compose service it belongs to. */
  service: string;
  status: string;
  /** Null when the container never started — docker's zero time. */
  startedAt: string | null;
  exitCode: number;
  /** The daemon's error from trying to start it (a port bind, a network), "" when none. */
  error: string;
  /** "", or the healthcheck's verdict. */
  health: string;
}

/** `docker inspect <ids>` → facts. Unparseable input is no facts, which classifies as the environment's. */
export function parseInspect(json: string): ContainerFacts[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  return array(parsed).map((raw) => {
    const container = raw as { Config?: { Labels?: Record<string, string> }; State?: Record<string, unknown>; Name?: string };
    const state = container.State ?? {};
    const startedAt = str(state.StartedAt);
    const health = (state.Health ?? {}) as Record<string, unknown>;
    return {
      service: container.Config?.Labels?.["com.docker.compose.service"] ?? str(container.Name).replace(/^\//, ""),
      status: str(state.Status),
      startedAt: startedAt && !startedAt.startsWith("0001-01-01") ? startedAt : null,
      exitCode: typeof state.ExitCode === "number" ? state.ExitCode : 0,
      error: str(state.Error),
      health: str(health.Status),
    };
  });
}

/**
 * Why `compose up --no-build --wait` failed, from the containers it left.
 *
 * The images are already built, so what is left is starting them, and the
 * daemon records the two ways that goes wrong differently:
 *
 *   never started, with `State.Error` → environment. The daemon could not
 *     start it: a host port already allocated, a network, a mount. Checked
 *     FIRST, because the app was never given its chance — and a dependent left
 *     waiting on it is a consequence, not a second cause.
 *   started, then exited or unhealthy → the app's when the container is one
 *     of the project's own services (`appServices`, built from its
 *     Dockerfile); the environment's when it is one `wire` supplies (the
 *     database).
 *   nothing to point at → environment: compose failed before or around the
 *     containers (its network, the image store).
 */
export function classifyUp(containers: ContainerFacts[], appServices: ReadonlySet<string>): WireFailure & { service: string } {
  const unstartable = containers.find((c) => c.startedAt === null && c.error);
  if (unstartable) {
    return {
      cause: "environment",
      service: unstartable.service,
      reason: `${unstartable.service} could not be started: ${unstartable.error}`,
    };
  }
  const died = containers.find((c) => c.startedAt !== null && (c.status === "exited" || c.status === "dead" || c.health === "unhealthy"));
  if (died) {
    const how = died.health === "unhealthy" ? "never turned healthy" : `exited with code ${String(died.exitCode)}`;
    return appServices.has(died.service)
      ? { cause: "app", service: died.service, reason: `${died.service} started and ${how}` }
      : { cause: "environment", service: died.service, reason: `${died.service} (supplied by wire) started and ${how}` };
  }
  return { cause: "environment", service: "", reason: "compose could not start the project, and no container says why" };
}

// --- the dev server ---------------------------------------------------------

export interface DevServerFacts {
  /** The process had exited by the time the wait ended; its code, or null when it was still running. */
  exitCode: number | null;
  /** After it exited, something else was listening on its port. */
  portHeldByOther: boolean;
  url: string;
}

/**
 * Why the dev server did not answer within its wait.
 *
 * The tree it runs from was installed by THIS host (`needsInstall`'s stamp is
 * the precondition `startWiredDevServer` runs under), so a foreign install
 * cannot be what killed it. That leaves:
 *
 *   exited, and another process holds its port → environment. `--strictPort`
 *     makes Vite exit rather than move when its port is taken.
 *   exited otherwise → app. Vite died on the project's own startup path: its
 *     config, its mock plugin, a dependency its package.json does not carry.
 *   still running, never answered → environment. Vite binds and serves its
 *     index before it compiles a single module, so silence for the whole wait
 *     is the machine, not the app's code.
 */
export function classifyDevServer(facts: DevServerFacts): WireFailure {
  if (facts.exitCode !== null) {
    if (facts.portHeldByOther) {
      return { cause: "environment", reason: `the dev server's port is held by another process (${facts.url})` };
    }
    return {
      cause: "app",
      reason: `the dev server exited (code ${String(facts.exitCode)}) before answering on ${facts.url} — see .aep-playground/wire/logs/webapp.log`,
    };
  }
  return { cause: "environment", reason: `the dev server is running but did not answer on ${facts.url}` };
}

// --- shared -----------------------------------------------------------------

function jsonRecords(output: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of output.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object") records.push(value as Record<string, unknown>);
    } catch {
      // Not a progress record: compose's own prose shares the stream.
    }
  }
  return records;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
