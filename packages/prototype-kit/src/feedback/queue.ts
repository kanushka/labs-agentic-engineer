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
 * The Annotate queue a review keeps, headless, so every host (the console,
 * the kit CLI's preview) keeps it the same way and only draws its own UI:
 *
 *  - queued comments, numbered 1.. as their pins show them, on the revision
 *    the first was queued on; one can be edited or removed in place;
 *  - drafts: a comment the reviewer started on some elements and closed
 *    without adding, kept per screen and set of elements (in whatever order
 *    they were selected) so selecting them again restores it. A draft is
 *    neither counted against the limit nor sent;
 *  - how the open comment follows the selection (`followSelection`), so
 *    typed text is never lost.
 *
 * Every operation returns a new queue (the same one when it refuses).
 */

import type { PrototypeViewState } from "../host/view-state.js";
import { MAX_FEEDBACK_REQUESTS, type FeedbackRequest, type FeedbackSubmission } from "./request.js";

export interface FeedbackQueue {
  /** The revision the first queued comment was made on; null while none is queued. */
  hash: string | null;
  requests: readonly FeedbackRequest[];
  /** Started comments, each on its own screen and set of elements; never sent. */
  drafts: readonly FeedbackRequest[];
}

export const EMPTY_FEEDBACK_QUEUE: FeedbackQueue = Object.freeze({ hash: null, requests: [], drafts: [] });

/** A request on the current screen, flow, role and state, for the selection in the order it was made (none: the whole screen). */
export function requestFor(view: PrototypeViewState, text: string): FeedbackRequest {
  return {
    screenId: view.screenId,
    ...(view.flowId !== null ? { flowId: view.flowId } : {}),
    roleId: view.roleId,
    stateId: view.stateId,
    elementIds: [...view.selectedKeys],
    text,
  };
}

/** For each element a queued request on this screen names, the requests' 1-based queue numbers. */
export function pinsOnScreen(queue: readonly FeedbackRequest[], screenId: string): Record<string, number[]> {
  const pins: Record<string, number[]> = {};
  queue.forEach((request, i) => {
    if (request.screenId !== screenId) return;
    for (const id of request.elementIds) pins[id] = [...(pins[id] ?? []), i + 1];
  });
  return pins;
}

/** Whether `a` and `b` name the same elements, in any order. */
function sameElements(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

const samePlace = (draft: FeedbackRequest, screenId: string, elementIds: readonly string[]) =>
  draft.screenId === screenId && sameElements(draft.elementIds, elementIds);

const withoutDraftAt = (drafts: readonly FeedbackRequest[], screenId: string, elementIds: readonly string[]) =>
  drafts.filter((d) => !samePlace(d, screenId, elementIds));

/** Queue a comment, refused once the queue is full; it uses up the draft on its elements. */
export function enqueue(queue: FeedbackQueue, hash: string, request: FeedbackRequest): FeedbackQueue {
  if (queue.requests.length >= MAX_FEEDBACK_REQUESTS) return queue;
  return {
    hash: queue.hash ?? hash,
    requests: [...queue.requests, request],
    drafts: withoutDraftAt(queue.drafts, request.screenId, request.elementIds),
  };
}

/** The `index`th (0-based) comment with new text; refused for empty text or a comment it does not hold. */
export function editRequest(queue: FeedbackQueue, index: number, text: string): FeedbackQueue {
  const request = queue.requests[index];
  if (!request || text.trim() === "") return queue;
  return { ...queue, requests: queue.requests.map((r, i) => (i === index ? { ...r, text } : r)) };
}

/** The queue without its `index`th (0-based) comment; the rest renumber. Emptied, it forgets its revision. */
export function dequeue(queue: FeedbackQueue, index: number): FeedbackQueue {
  const requests = queue.requests.filter((_, i) => i !== index);
  return { hash: requests.length === 0 ? null : queue.hash, requests, drafts: queue.drafts };
}

/** Keep `draft` as the draft on its screen and elements (replacing any there); empty text drops it. */
export function keepDraft(queue: FeedbackQueue, draft: FeedbackRequest): FeedbackQueue {
  const others = withoutDraftAt(queue.drafts, draft.screenId, draft.elementIds);
  return { ...queue, drafts: draft.text.trim() === "" ? others : [...others, draft] };
}

/** The draft on these elements of this screen, if any. */
export function draftAt(queue: FeedbackQueue, screenId: string, elementIds: readonly string[]): FeedbackRequest | undefined {
  return queue.drafts.find((d) => samePlace(d, screenId, elementIds));
}

/** The elements of this screen that show a draft pin: each draft's first element, once. A whole-screen draft has none. */
export function draftPinsOnScreen(queue: FeedbackQueue, screenId: string): string[] {
  return [...new Set(queue.drafts.filter((d) => d.screenId === screenId && d.elementIds.length > 0).map((d) => d.elementIds[0] as string))];
}

/** The draft the draft pin on `key` opens: the latest one drawn there. */
export function draftOfPin(queue: FeedbackQueue, screenId: string, key: string): FeedbackRequest | undefined {
  return [...queue.drafts].reverse().find((d) => d.screenId === screenId && d.elementIds[0] === key);
}

/** What a host sends: the queued comments on their revision (never the drafts); null while none is queued. */
export function submissionOf(queue: FeedbackQueue): FeedbackSubmission | null {
  return queue.hash === null || queue.requests.length === 0 ? null : { prototypeHash: queue.hash, requests: [...queue.requests] };
}

/**
 * The open comment's text and the queue after the selection moved from
 * `before` (with `text` typed for it) to `after`. A comment is open while
 * something is selected. Shift (`carry`) adding or taking out an element
 * carries the text along; any other change keeps the text as a draft on
 * the elements it was written for, and opens the comment on the new
 * selection with its draft, if it has one.
 */
export function followSelection(
  queue: FeedbackQueue,
  before: PrototypeViewState,
  text: string,
  after: PrototypeViewState,
  carry: boolean,
): { queue: FeedbackQueue; text: string } {
  if (before.screenId === after.screenId && sameElements(before.selectedKeys, after.selectedKeys)) return { queue, text };
  if (carry && after.selectedKeys.length > 0) return { queue, text };
  const kept = before.selectedKeys.length > 0 ? keepDraft(queue, requestFor(before, text)) : queue;
  return { queue: kept, text: after.selectedKeys.length > 0 ? (draftAt(kept, after.screenId, after.selectedKeys)?.text ?? "") : "" };
}
