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
 * The score, in code (decision 5) — the judge says pass or fail per item and
 * whether each mustNot was violated; it never produces a number.
 *
 * Weighted pass ratio × 100 over the checklist items plus the `mustCover`
 * extras. An item the walker could not attempt (`blocked`) is a FAIL: from a
 * user's side a screen they cannot reach does not work. A violated mustNot
 * caps the band at `review`, whatever the ratio — the same rule as the
 * spec-agents evals (`evals/spec-agents/src/scoring/bands.ts`).
 *
 * Pure: everything it needs arrives as arguments.
 */

import type { Item } from "./case.js";
import { BANDS } from "./config.js";

export type Band = "pass" | "review" | "fail";

/** The walker's own verdict on an item — the evidence, not the score. */
export type WalkVerdict = "pass" | "fail" | "blocked";

export interface JudgedItem {
  id: string;
  verdict: "pass" | "fail";
  /** What a user would see, one sentence; empty on a pass. */
  symptom: string;
}

export interface JudgedMustNot {
  id: string;
  violated: boolean;
  evidence: string;
}

export interface Judgement {
  items: JudgedItem[];
  mustNot: JudgedMustNot[];
  summary: string;
}

export interface Score {
  /** 0..100, rounded. */
  score: number;
  band: Band;
  /** True when a mustNot pulled a would-be pass down to review. */
  capped: boolean;
  violated: string[];
  /** Failing items, heaviest first — the report's "top failing items". */
  failing: { id: string; weight: number; symptom: string }[];
}

export function bandFor(score: number, mustNotViolated: boolean): { band: Band; capped: boolean } {
  const raw: Band = score >= BANDS.pass ? "pass" : score >= BANDS.review ? "review" : "fail";
  if (mustNotViolated && raw === "pass") return { band: "review", capped: true };
  return { band: raw, capped: false };
}

/**
 * Score one attempt.
 *
 * An item passes only when the judge says pass AND the walker did not report
 * it blocked — a judge that passes an item nobody could attempt is wrong, and
 * the score should not inherit the mistake. An item the judge returned no
 * entry for is a fail, named as such, rather than silently left out of the
 * denominator (which would raise the score).
 */
export function scoreAttempt(
  items: Item[],
  judgement: Judgement,
  walk: Map<string, WalkVerdict>,
): Score {
  const judged = new Map(judgement.items.map((entry) => [entry.id, entry]));
  let total = 0;
  let passed = 0;
  const failing: Score["failing"] = [];
  for (const item of items) {
    total += item.weight;
    const verdict = judged.get(item.id);
    const blocked = walk.get(item.id) === "blocked";
    if (verdict?.verdict === "pass" && !blocked) {
      passed += item.weight;
      continue;
    }
    failing.push({
      id: item.id,
      weight: item.weight,
      symptom: verdict?.symptom || (blocked ? "blocked — the walker could not attempt it" : "not judged"),
    });
  }
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;
  const violated = judgement.mustNot.filter((entry) => entry.violated).map((entry) => entry.id);
  const { band, capped } = bandFor(score, violated.length > 0);
  failing.sort((a, b) => b.weight - a.weight);
  return { score, band, capped, violated, failing };
}
