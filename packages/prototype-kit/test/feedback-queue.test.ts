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

/** A review's comment queue, as both hosts keep it: queued comments (edited and removed in place) and drafts (kept, never sent). */

import { describe, expect, it } from "vitest";
import {
  EMPTY_FEEDBACK_QUEUE,
  MAX_FEEDBACK_REQUESTS,
  dequeue,
  draftAt,
  draftOfPin,
  draftPinsOnScreen,
  editRequest,
  enqueue,
  keepDraft,
  keepOnScreen,
  orphansOnScreen,
  pinsOnScreen,
  submissionOf,
  type FeedbackQueue,
  type FeedbackRequest,
} from "../src/feedback/index.js";
import type { PrototypeViewState } from "../src/host/view-state.js";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

const on = (elementIds: string[], text: string, screenId = "queue"): FeedbackRequest => ({ screenId, roleId: "approver", stateId: "default", elementIds, text });

function queued(...requests: FeedbackRequest[]): FeedbackQueue {
  return requests.reduce((q, r) => enqueue(q, H1, r), EMPTY_FEEDBACK_QUEUE);
}

describe("queued comments", () => {
  it("keeps the revision the first comment was made on", () => {
    const q = enqueue(enqueue(EMPTY_FEEDBACK_QUEUE, H1, on(["a"], "one")), H2, on(["b"], "two"));
    expect(q.hash).toBe(H1);
    expect(q.requests.map((r) => r.text)).toEqual(["one", "two"]);
  });

  it("refuses a comment once the queue holds the most a submission takes", () => {
    const full = queued(...Array.from({ length: MAX_FEEDBACK_REQUESTS }, (_, i) => on(["a"], `c${i}`)));
    expect(enqueue(full, H1, on(["a"], "one more"))).toBe(full);
  });

  it("edits a comment in place, keeping its number and elements", () => {
    const q = editRequest(queued(on(["a"], "one"), on(["b"], "two")), 1, "two, better");
    expect(q.requests).toEqual([on(["a"], "one"), on(["b"], "two, better")]);
    expect(pinsOnScreen(q.requests, "queue")).toEqual({ a: [1], b: [2] });
  });

  it("refuses an edit to empty text or of a comment it does not hold", () => {
    const q = queued(on(["a"], "one"));
    expect(editRequest(q, 0, "  ")).toBe(q);
    expect(editRequest(q, 3, "nope")).toBe(q);
  });

  it("removes a comment and renumbers the rest; an emptied queue forgets its revision", () => {
    const q = dequeue(queued(on(["a"], "one"), on(["b"], "two")), 0);
    expect(pinsOnScreen(q.requests, "queue")).toEqual({ b: [1] });
    expect(dequeue(q, 0)).toEqual(EMPTY_FEEDBACK_QUEUE);
    expect(enqueue(dequeue(q, 0), H2, on(["a"], "fresh")).hash).toBe(H2);
  });

  it("submits the queued comments on their revision, and nothing while none is queued", () => {
    const q = keepDraft(queued(on(["a"], "one")), on(["b"], "half"));
    expect(submissionOf(q)).toEqual({ prototypeHash: H1, requests: [on(["a"], "one")] });
    expect(submissionOf(keepDraft(EMPTY_FEEDBACK_QUEUE, on(["b"], "half")))).toBeNull();
  });
});

describe("drafts", () => {
  it("keeps a started comment per set of elements, restored whatever order they were selected in", () => {
    const q = keepDraft(EMPTY_FEEDBACK_QUEUE, on(["a", "b"], "Swap these"));
    expect(draftAt(q, "queue", ["b", "a"])?.text).toBe("Swap these");
    expect(draftAt(q, "queue", ["a"])).toBeUndefined();
    expect(draftAt(q, "detail", ["a", "b"])).toBeUndefined();
  });

  it("replaces the draft on the same elements, and drops it when its text is cleared", () => {
    const q = keepDraft(keepDraft(EMPTY_FEEDBACK_QUEUE, on(["a"], "first")), on(["a"], "second"));
    expect(q.drafts).toEqual([on(["a"], "second")]);
    expect(keepDraft(q, on(["a"], " ")).drafts).toEqual([]);
  });

  it("is neither counted nor sent: a full queue still keeps drafts", () => {
    const full = queued(...Array.from({ length: MAX_FEEDBACK_REQUESTS }, (_, i) => on(["a"], `c${i}`)));
    const q = keepDraft(full, on(["b"], "later"));
    expect(q.requests).toHaveLength(MAX_FEEDBACK_REQUESTS);
    expect(submissionOf(q)?.requests).not.toContainEqual(on(["b"], "later"));
  });

  it("is used up when the comment on its elements is added", () => {
    const q = enqueue(keepDraft(EMPTY_FEEDBACK_QUEUE, on(["a", "b"], "Swap")), H1, on(["b", "a"], "Swap these"));
    expect(q.drafts).toEqual([]);
  });

  it("shows one hollow pin per draft on its first element, and a pin opens the latest draft there", () => {
    let q = keepDraft(EMPTY_FEEDBACK_QUEUE, on(["a", "b"], "pair"));
    q = keepDraft(q, on(["c"], "single"));
    q = keepDraft(q, on(["a"], "alone"));
    q = keepDraft(q, on(["d"], "elsewhere", "detail"));
    q = keepDraft(q, on([], "whole screen"));
    expect(draftPinsOnScreen(q, "queue")).toEqual(["a", "c"]);
    expect(draftOfPin(q, "queue", "a")?.text).toBe("alone");
    expect(draftOfPin(q, "queue", "b")).toBeUndefined();
  });
});

describe("comments whose elements a revision took away", () => {
  const view = (screenId: string, roleId = "approver", stateId = "default"): PrototypeViewState => ({
    mode: "annotate",
    screenId,
    flowId: null,
    roleId,
    stateId,
    selectedKeys: [],
  });

  it("flags the comments on this screen, role and state naming an element the screen no longer draws", () => {
    const q = queued(on(["a"], "kept"), on(["gone"], "orphan"), on(["a", "gone"], "half gone"), on([], "whole screen"), on(["gone"], "elsewhere", "other"));
    expect(orphansOnScreen(q.requests, view("queue"), ["a", "b"])).toEqual([1, 2]);
  });

  it("leaves alone comments made as another role or in another state, where the element may well be drawn", () => {
    const q = queued(on(["gone"], "as approver"));
    expect(orphansOnScreen(q.requests, view("queue", "employee"), ["a"])).toEqual([]);
    expect(orphansOnScreen(q.requests, view("queue", "approver", "empty"), ["a"])).toEqual([]);
  });

  it("keeps a comment as a comment on its whole screen, at its number", () => {
    const q = keepOnScreen(queued(on(["a"], "one"), on(["gone"], "two")), 1);
    expect(q.requests).toEqual([on(["a"], "one"), on([], "two")]);
    expect(pinsOnScreen(q.requests, "queue")).toEqual({ a: [1] });
    expect(keepOnScreen(q, 5)).toBe(q);
  });
});
