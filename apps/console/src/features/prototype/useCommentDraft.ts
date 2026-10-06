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

import { useEffect, useRef, useState } from "react";
import { followSelection, keepDraft, requestFor, type FeedbackQueue } from "@wso2/prototype-kit/feedback";
import type { PrototypeViewState } from "@wso2/prototype-kit/host";
import type { ReviewState } from "./model/review";

/** A change to the review's comment queue, applied to the latest queue (several can land in one event). */
export type QueueUpdate = (queue: FeedbackQueue) => FeedbackQueue;

export interface CommentDraft {
  /** The open new comment's text. */
  text: string;
  setText: (text: string) => void;
  /** The selection's next change is a Shift-click: the text goes along to the new selection. */
  carryNext: () => void;
}

/** The view as far as the open comment goes: the selection while its bubble is open on it, none otherwise. */
function commentedOn({ view, bubble }: ReviewState): PrototypeViewState {
  return bubble?.on === "selection" ? view : { ...view, selectedKeys: [] };
}

/**
 * The new comment's text, never lost (#885): whenever the bubble on a
 * selection closes, or a plain click moves it to other elements, its text is
 * kept as a draft on the elements it was written for (the kit's queue model,
 * `followSelection`); a bubble opening on elements that hold a draft starts
 * from it. The same holds when the review goes away with the bubble open. A
 * whole-screen comment's bubble starts empty.
 */
export function useCommentDraft({ review, queue, onQueue }: { review: ReviewState; queue: FeedbackQueue; onQueue: (update: QueueUpdate) => void }): CommentDraft {
  const [text, setText] = useState("");
  const shown = useRef(review);
  const carry = useRef(false);

  useEffect(() => {
    const before = shown.current;
    if (before === review) return;
    shown.current = review;
    const from = commentedOn(before);
    const to = commentedOn(review);
    const along = carry.current;
    carry.current = false;
    const next = followSelection(queue, from, text, to, along);
    if (next.queue !== queue) onQueue((q) => followSelection(q, from, text, to, along).queue);
    const screenBubble = (r: ReviewState) => r.bubble?.on === "screen";
    setText(screenBubble(before) !== screenBubble(review) ? "" : next.text);
  }, [review, queue, text, onQueue]);

  // The review going away (closed, sent, or its prototype gone) keeps the open comment's text as a draft.
  const latest = useRef({ review, text, onQueue });
  latest.current = { review, text, onQueue };
  useEffect(
    () => () => {
      const { review, text, onQueue } = latest.current;
      const on = commentedOn(review);
      if (on.selectedKeys.length > 0 && text.trim() !== "") onQueue((q) => keepDraft(q, requestFor(on, text)));
    },
    [],
  );

  return {
    text,
    setText,
    carryNext: () => {
      carry.current = true;
    },
  };
}
