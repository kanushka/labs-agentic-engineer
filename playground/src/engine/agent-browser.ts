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
 * The `agent-browser` a HOST process drives a page with: the copy pinned as a
 * devDependency of the calling package, never whatever the developer's global
 * install happens to be. On its own, apart from `coding-run.ts`, because two
 * callers need it — `play code --host` and the `evals/codegen` walker — and the
 * walker must not import a module that pulls in `@aep/agents` (see
 * `runner-image.ts`).
 *
 * WHY A PIN AND NOT THE GLOBAL CLI: the runner image pins the CLI
 * (`AGENT_BROWSER_VERSION` in `runners/remote-worker/Dockerfile`), and a host
 * walker on another version measures a different tool. It did: a host 0.27.0
 * `click` landed on the footer over a button the image's version scrolls into
 * view, and the eval scored two working features as failures. Each package's
 * test holds its pin equal to the Dockerfile ARG.
 *
 * WHY `node_modules/.bin`: pnpm puts the package's launcher there, and that
 * launcher (`agent-browser/bin/agent-browser.js`) runs the native binary the
 * npm tarball already ships for every platform, making it executable on first
 * use. So the package needs NO install script, and pnpm blocks this one (the
 * root `onlyBuiltDependencies` does not list it) on purpose: its postinstall
 * re-points `$(npm prefix -g)/bin/agent-browser` at the LOCAL install,
 * silently swapping the developer's global CLI for this package's copy.
 */

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Where pnpm put `packageRoot`'s `agent-browser` launcher. */
export function agentBrowserBinDir(packageRoot: string): string {
  return join(packageRoot, "node_modules", ".bin");
}

/**
 * Why `binDir` cannot serve a walk, or undefined when it can. Checked before
 * anything is spent: without it the PATH below falls through to the global CLI,
 * which is the version skew this module exists to remove.
 */
export function agentBrowserProblem(binDir: string): string | undefined {
  if (existsSync(join(binDir, "agent-browser"))) return undefined;
  return `the pinned agent-browser is not installed at ${binDir} — run \`make install\``;
}

/** `env` with `binDir` FIRST on PATH, so a bare `agent-browser` is the pinned copy. */
export function withAgentBrowserFirst(env: NodeJS.ProcessEnv, binDir: string): NodeJS.ProcessEnv {
  return { ...env, PATH: env.PATH ? `${binDir}${delimiter}${env.PATH}` : binDir };
}
