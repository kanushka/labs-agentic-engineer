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
 * THE credential rule, in one module: the Claude subscription OAuth token from
 * `deployments/.env`'s `AEP_CODING_ANTHROPIC_KEY`, and never an API key — for
 * the coding run, the planner, the walker and the judge alike.
 *
 * Why one credential: a sweep is a comparison, and a harness whose billing
 * path can differ between two sweeps (a stray exported key here, a keychain
 * login there) compares runs that were not made the same way — Claude Code
 * ranks `ANTHROPIC_API_KEY` above every other credential, so a key that merely
 * EXISTS in the environment silently wins. Every env this module builds is
 * therefore built by removing the competitors, not by adding the token.
 *
 * The token value never leaves this module's return values: it is not logged,
 * not written to any archive, and not put on an argv (`ps` reads argv).
 */

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { CONNECTION_ENV } from "./config.js";

/** The `.env` key the token lives under — the playground's own coding-credential name (ADR-0016). */
export const TOKEN_KEY = "AEP_CODING_ANTHROPIC_KEY";
/** What a `claude setup-token` OAuth token starts with; an API key is `sk-ant-api…`. */
export const OAUTH_PREFIX = "sk-ant-oat";

/** A refusal before anything is spent — the CLI maps it to exit 2. */
export class CredentialError extends Error {
  override name = "CredentialError";
}

/**
 * Read the token out of `envFile` without loading the file into this process.
 *
 * `util.parseEnv` over `process.loadEnvFile` on purpose: loading would put
 * the file's `ANTHROPIC_API_KEY` into `process.env`, where every child env
 * built from it would have to remember to strip it again.
 */
export function readOAuthToken(envFile: string): string {
  let text: string;
  try {
    text = readFileSync(envFile, "utf8");
  } catch {
    throw new CredentialError(`cannot read ${envFile} — the codegen evals take their one credential from it`);
  }
  return oauthTokenFrom(parseEnv(text));
}

/** The validation half of `readOAuthToken`, over an already-parsed file. */
export function oauthTokenFrom(parsed: Record<string, string | undefined>): string {
  const value = parsed[TOKEN_KEY]?.trim() ?? "";
  if (value === "") throw new CredentialError(`${TOKEN_KEY} is not set in deployments/.env`);
  if (!value.startsWith(OAUTH_PREFIX)) {
    // Says WHAT it is not, never what it is: the value stays out of every message.
    throw new CredentialError(
      `${TOKEN_KEY} is not a Claude OAuth token (expected the ${OAUTH_PREFIX}… prefix from \`claude setup-token\`). ` +
        "The codegen evals refuse to run on an API key.",
    );
  }
  return value;
}

/** A model connection for an `opencode` config: literal values plus the NAME of the key's variable. */
export interface ConnectionSpec {
  format: string;
  baseUrl: string;
  authScheme?: string | undefined;
  /** The env var holding the connection's key, read from `deployments/.env` (then the shell). */
  apiKeyEnv: string;
}

/** What one `configs.yaml` entry contributes to a coding run's environment. */
export interface RunEnvSpec {
  runtime: string;
  model: string;
  connection?: ConnectionSpec | undefined;
}

/**
 * The env of a `play` subprocess (`code`, `wire`).
 *
 * `ANTHROPIC_API_KEY` is set to the EMPTY STRING rather than deleted: `play`
 * calls `process.loadEnvFile("deployments/.env")`, which fills only variables
 * that are absent — an empty one stays empty, a deleted one comes back holding
 * the platform key. The playground then sees the OAuth token in
 * `AEP_CODING_ANTHROPIC_KEY` and forwards ONLY `CLAUDE_CODE_OAUTH_TOKEN` into
 * the runner container (`codingCredential` in `playground/src/engine/coding-run.ts`).
 *
 * The connection variables are blanked the same way for a Claude Code config:
 * an `AEP_MODEL_FORMAT` exported in the developer's shell would otherwise put
 * the run on that connection, and the report would credit Claude with it.
 *
 * For an `opencode` config the connection IS the credential, and the token is
 * blanked instead — the playground refuses OpenCode on an OAuth token.
 */
export function playEnv(
  parent: NodeJS.ProcessEnv,
  token: string,
  spec: RunEnvSpec,
  dotenv: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env = withoutClaudeSession(parent);
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.ANTHROPIC_API_KEY = "";
  env.AEP_AGENT_RUNTIME = spec.runtime;
  env.AEP_AGENT_MODEL = spec.model;
  for (const name of CONNECTION_ENV) env[name] = "";
  if (!spec.connection) {
    env[TOKEN_KEY] = token;
    return env;
  }
  const key = (dotenv[spec.connection.apiKeyEnv] ?? parent[spec.connection.apiKeyEnv] ?? "").trim();
  if (key === "") {
    throw new CredentialError(
      `${spec.connection.apiKeyEnv} is not set (deployments/.env or the shell) — the ${spec.runtime} connection's key`,
    );
  }
  env[TOKEN_KEY] = "";
  env.AEP_MODEL_FORMAT = spec.connection.format;
  env.AEP_MODEL_BASE_URL = spec.connection.baseUrl;
  if (spec.connection.authScheme) env.AEP_MODEL_AUTH_SCHEME = spec.connection.authScheme;
  env.AEP_MODEL_API_KEY = key;
  return env;
}

/**
 * The env of the harness's own Agent SDK sessions (planner, walker, judge):
 * the parent's, minus every API-key form, plus the token where Claude Code
 * reads an OAuth token. `assertNotApiKey` then checks what the session
 * actually authenticated with, because the env is only what was intended.
 */
export function sdkEnv(parent: NodeJS.ProcessEnv, token: string): NodeJS.ProcessEnv {
  const env = withoutClaudeSession(parent);
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

/**
 * The parent's env minus every trace of a SURROUNDING Claude Code session:
 * `CLAUDECODE` and every `CLAUDE_CODE_*` variable, `CLAUDE_CODE_OAUTH_TOKEN`
 * included. A sweep started from inside Claude Code would otherwise hand each
 * child that session's identity, its messaging socket and the token that
 * authenticates to it — none of which is the harness's to pass on, and any of
 * which can change how a nested CLI behaves.
 */
export function withoutClaudeSession(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent)) {
    if (name === "CLAUDECODE" || name.startsWith("CLAUDE_CODE_")) continue;
    env[name] = value;
  }
  return env;
}

/**
 * `system/init`'s `apiKeySource` values that mean an API key. An OAuth token
 * reports `none` ("no API key in use"); these three are the CLI's names for a
 * key from the environment, from a helper command, or minted by a Console
 * `/login`.
 */
const API_KEY_SOURCES = new Set(["ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key"]);

/** Throws when a session authenticated with an API key — the attempt becomes a harness error. */
export function assertNotApiKey(apiKeySource: string | undefined): void {
  if (apiKeySource !== undefined && API_KEY_SOURCES.has(apiKeySource)) {
    throw new CredentialError(`an SDK session authenticated with an API key (apiKeySource=${apiKeySource}) — refused`);
  }
}
