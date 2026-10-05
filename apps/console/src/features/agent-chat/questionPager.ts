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

// The pure half of a batch card's walk (ADR-0002 / #879): one question per
// page, then the Answers page that sends them. The answer form's own rules
// (what counts as answered, how a pick toggles) stay in questionCards.ts.

import type { AskQuestionInput, QuestionAnswer } from "@aep/agent-stream";
import { isFreeTextOption, isQuestionAnswered } from "./questionCards";

/** A question, by its index in the batch, or the Answers page that ends it. */
export type PagerPage = number | "answers";

/**
 * Whether picking `label` moves the card on: only a single-choice pick that
 * turned an option ON, and not a free-text escape ("Other"), whose real answer
 * is still to be typed. Multi-choice and typed answers move on with Next.
 */
export function advancesOnPick(q: AskQuestionInput, after: QuestionAnswer, label: string): boolean {
  if (q.multiSelect === true || !after.selected.includes(label)) return false;
  const opt = q.options.find((o) => o.label === label);
  return opt !== undefined && !isFreeTextOption(opt);
}

/**
 * Where a pick on question `from` moves the card: the next unanswered question
 * after it, wrapping round to the start, or the Answers page once none is left.
 * Re-answering an early question so returns the user to the work still open.
 */
export function pageAfterPick(questions: AskQuestionInput[], answers: QuestionAnswer[], from: number): PagerPage {
  const n = questions.length;
  for (let step = 1; step < n; step++) {
    const i = (from + step) % n;
    if (!isQuestionAnswered(questions[i]!, answers[i])) return i;
  }
  return "answers";
}

/** The page Next goes to: the following question, then the Answers page. */
export function nextPage(count: number, page: PagerPage): PagerPage {
  if (page === "answers" || page + 1 >= count) return "answers";
  return page + 1;
}

/** The page Back goes to: the previous question; from the Answers page, the last one. */
export function previousPage(count: number, page: PagerPage): PagerPage {
  if (page === "answers") return Math.max(0, count - 1);
  return Math.max(0, page - 1);
}

/**
 * One question's answer as the Answers page lists it: the picked labels, then
 * the user's own words in quotes. A free-text escape's label is dropped (the
 * words are the answer); null while the question is unanswered.
 */
export function answerSummary(q: AskQuestionInput, answer: QuestionAnswer | undefined): string | null {
  if (!isQuestionAnswered(q, answer)) return null;
  const byLabel = new Map(q.options.map((o) => [o.label, o] as const));
  const labels = (answer?.selected ?? []).filter((label) => {
    const opt = byLabel.get(label);
    return opt !== undefined && !isFreeTextOption(opt);
  });
  const typed = answer?.freeText?.trim();
  return [...(labels.length > 0 ? [labels.join(", ")] : []), ...(typed ? [`“${typed}”`] : [])].join(" · ");
}
