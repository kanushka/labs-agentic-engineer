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

// Shared connection derivation plus the Deployments page's promotion-readiness
// model. Builds reuses the rows for development configuration; the production
// values and promotion calculations remain local to this module's consumers.
//
// A promotion collects PRODUCTION values for the design's connections: dev
// credentials never travel to another environment, so every connection that
// carries config keys has to be filled in again at the moment of promotion.
// The connection list is derived from the design-dependencies read the Spec
// view already uses (the console's single dependency-status read model) —
// promotion introduces no new contract surface. The VALUES have no backend
// yet (there is no promote endpoint in the contract), so they live in page
// state; this module is the pure derivation layer over both.

import type { components } from "../../../generated/aep-api";

type ComponentDependencies = components["schemas"]["ComponentDependencies"];
type Dependency = components["schemas"]["Dependency"];
type ConfigKey = components["schemas"]["ConfigKey"];

/** One design-declared connection exposed to configuration consumers. */
export interface ConnectionRow {
  /** Dedupe identity — also the key entered values are stored under. */
  id: string;
  name: string;
  /** The design-authored dependency description. */
  description?: string;
  /** The dependency's kind — an "external" connection's values can be
   *  re-collected through collect-external-resource-values; a platform
   *  resource's cannot (the platform owns its credentials). */
  kind: string;
  /** The platform resource type ("postgres-cnpg"), shown beside the name. */
  detail?: string;
  /** The config-key schema this connection declares; [] when there is none. */
  config: ConfigKey[];
  /** No user-entered values to collect — the platform provisions it. */
  provisioned: boolean;
}

/** Entered production values, keyed connection id → config key → value. */
export type ConnectionValues = Record<string, Record<string, string>>;

// The same dedupe identity the Spec view uses (dependencyUsedBy.ts): a shared
// dependency is declared independently on every consuming component's
// design.json, and a configuration surface must ask for its values once, not
// once per consumer. Config keys are unioned below to match server readiness.
function dependencyIdentity(dep: Dependency): string {
  return dep.kind === "platform-resource"
    ? `platform-resource:${dep.resourceType ?? ""}:${dep.name}`
    : `${dep.kind}:${dep.name}`;
}

/**
 * Every connection in the design, deduped across components, component-to-
 * component wiring excluded (an internal call edge has no production values —
 * the platform rewires siblings itself on promotion).
 */
export function connectionRows(
  all: ComponentDependencies[] | null | undefined,
): ConnectionRow[] {
  const byId = new Map<string, ConnectionRow>();
  for (const comp of all ?? []) {
    for (const dep of comp.dependencies ?? []) {
      if (dep.kind === "component") continue;
      const id = dependencyIdentity(dep);
      const existing = byId.get(id);
      if (existing) {
        const configByKey = new Map(
          existing.config.map((key, index) => [key.key, index]),
        );
        for (const key of dep.config ?? []) {
          const index = configByKey.get(key.key);
          if (index === undefined) {
            configByKey.set(key.key, existing.config.length);
            existing.config.push(key);
          } else if (key.secret && !existing.config[index]?.secret) {
            existing.config[index] = { ...existing.config[index]!, secret: true };
          }
        }
        existing.provisioned = existing.config.length === 0;
        continue;
      }
      const config = [...(dep.config ?? [])];
      byId.set(id, {
        id,
        name: dep.name,
        ...(dep.description && { description: dep.description }),
        kind: dep.kind,
        ...(dep.resourceType && { detail: dep.resourceType }),
        config,
        provisioned: config.length === 0,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Initial values: a config key's defaultValue counts as already set. */
export function seedValues(rows: ConnectionRow[]): ConnectionValues {
  const values: ConnectionValues = {};
  for (const row of rows) {
    const entries = row.config.filter((k) => k.defaultValue);
    if (entries.length === 0) continue;
    values[row.id] = Object.fromEntries(
      entries.map((k) => [k.key, k.defaultValue ?? ""]),
    );
  }
  return values;
}

/** Does this connection have every production value it needs? */
export function connectionIsSet(
  row: ConnectionRow,
  values: ConnectionValues,
): boolean {
  return row.config.every((k) => (values[row.id]?.[k.key] ?? "").trim() !== "");
}

/** How many connections are ready (provisioned ones count — they need nothing). */
export function configuredCount(
  rows: ConnectionRow[],
  values: ConnectionValues,
): number {
  return rows.filter((row) => row.provisioned || connectionIsSet(row, values))
    .length;
}

/** Every connection accounted for — the promote gate. */
export function allConnectionsSet(
  rows: ConnectionRow[],
  values: ConnectionValues,
): boolean {
  return configuredCount(rows, values) === rows.length;
}

// Validation states that BLOCK promotion: a verdict still being earned
// (running / awaiting-fix) or an outright red one (failed / unreported).
// Everything else promotes — passed and partial on their merits, skipped /
// none / inconclusive because there is no verdict to wait for.
const BLOCKING_VALIDATION = new Set([
  "running",
  "awaiting-fix",
  "failed",
  "unreported",
]);

/** Can this deploy state offer promotion at all? Dev must be live and the
 *  validation verdict must not be pending or failing. */
export function canPromote(deploy: {
  status: string;
  validation: string;
}): boolean {
  return deploy.status === "deployed" && !BLOCKING_VALIDATION.has(deploy.validation);
}
