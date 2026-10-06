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
 * The open new comment's text, never lost: whenever its bubble closes, or a
 * plain click moves it to other elements, or the screen it was on goes, the
 * text is kept as a draft where it was written (on the elements, or on the
 * whole screen), and a bubble opening where a draft is kept starts from it.
 * Shift-click carries the text along to the grown or shrunk selection.
 */

import { useEffect, useRef, useState } from "react";
import { draftAt, keepDraft, requestFor, type FeedbackQueue } from "@wso2/prototype-kit/feedback";
import type { PrototypeViewState, ReviewState } from "@wso2/prototype-kit/host";

/** A change to the comment queue, applied to the latest queue (several can land in one event). */
export type QueueUpdate = (queue: FeedbackQueue) => FeedbackQueue;

export interface CommentDraft {
  /** The open new comment's text. */
  text: string;
  setText: (text: string) => void;
  /** The selection's next change is a Shift-click: the text goes along to the new selection. */
  carryNext: () => void;
}

/** Where the open new comment is: the selected elements, or (no elements) the whole screen; null when no new comment is open. */
function writingOn({ view, bubble }: ReviewState): PrototypeViewState | null {
  if (bubble?.on === "selection") return view;
  if (bubble?.on === "screen") return { ...view, selectedKeys: [] };
  return null;
}

function samePlace(a: PrototypeViewState | null, b: PrototypeViewState | null): boolean {
  if (a === null || b === null) return a === b;
  return a.screenId === b.screenId && a.selectedKeys.length === b.selectedKeys.length && a.selectedKeys.every((k) => b.selectedKeys.includes(k));
}

/** The queue and the open comment's text once it moved from `from` (with `text` typed there) to `to`. */
function follow(queue: FeedbackQueue, from: PrototypeViewState | null, text: string, to: PrototypeViewState | null, carry: boolean) {
  if (samePlace(from, to)) return { queue, text };
  if (carry && from !== null && to !== null && from.selectedKeys.length > 0 && to.selectedKeys.length > 0) return { queue, text };
  const kept = from === null ? queue : keepDraft(queue, requestFor(from, text));
  return { queue: kept, text: to === null ? "" : (draftAt(kept, to.screenId, to.selectedKeys)?.text ?? "") };
}

export function useCommentDraft({ review, queue, onQueue }: { review: ReviewState; queue: FeedbackQueue; onQueue: (update: QueueUpdate) => void }): CommentDraft {
  const [text, setText] = useState("");
  const shown = useRef(review);
  const carry = useRef(false);

  useEffect(() => {
    const before = shown.current;
    if (before === review) return;
    shown.current = review;
    const from = writingOn(before);
    const to = writingOn(review);
    const along = carry.current;
    carry.current = false;
    const next = follow(queue, from, text, to, along);
    if (next.queue !== queue) onQueue((q) => follow(q, from, text, to, along).queue);
    setText(next.text);
  }, [review, queue, text, onQueue]);

  return {
    text,
    setText,
    carryNext: () => {
      carry.current = true;
    },
  };
}
