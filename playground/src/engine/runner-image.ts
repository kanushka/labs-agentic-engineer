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
 * Which runner image a runtime runs on — on its own, apart from
 * `coding-run.ts`, because two callers need the answer and only one of them
 * runs a coding run. `evals/codegen` stamps the image's ID into every
 * attempt's provenance, and importing `coding-run.ts` for one lookup would
 * pull in `@aep/agents`, whose module scope merges `deployments/.env` into the
 * importer's environment.
 *
 * The OpenCode image is the Claude Code one plus the `opencode` binary, the
 * guard plugin and a pre-warmed home, but a Claude Code run stays on its own
 * image — the one a Claude Code org's pods run.
 */

import type { RuntimeName } from "remote-worker/src/runtime/port.js";

/** The env var that overrides a runtime's image, and the image when it is unset. */
export const RUNNER_IMAGES: Record<RuntimeName, { imageEnv: string; defaultImage: string }> = {
  "claude-code": { imageEnv: "AGENT_RUNNER_IMAGE", defaultImage: "aep-runner:dev" },
  opencode: { imageEnv: "AGENT_RUNNER_IMAGE_OPENCODE", defaultImage: "aep-runner-opencode:dev" },
};

export function runnerImage(runtime: RuntimeName, env: NodeJS.ProcessEnv = process.env): string {
  const image = RUNNER_IMAGES[runtime];
  return env[image.imageEnv] || image.defaultImage;
}
