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

import { useEffect, useState } from "react";
import { chatStore } from "../agent-chat/useProjectChat";
import type { PrototypeFeedback } from "../agent-chat/turnScope";
import type { AppPrototype } from "./model/prototypes";
import { NEW_SESSION, follow, sendStarted, turnEnded, type ReviewSession } from "./model/revision";
import type { QueueUpdate } from "./useCommentDraft";

export interface PrototypeReviews {
  /** The review of `component`: its queue, the batch out with the agent, what to say, and the revision to show. */
  session: (component: string) => ReviewSession;
  onQueue: (component: string, update: QueueUpdate) => void;
  /** The batch went to the agent as a turn. */
  onSent: (component: string, feedback: PrototypeFeedback) => void;
  /** The notice was seen (the toast closed). */
  onNoticeSeen: (component: string) => void;
}

/**
 * Each prototype's review as it outlives the review overlay (model/revision.ts):
 * its comment queue, the batch out with the agent, and the revision to show,
 * following the prototypes and the project's turns as they end.
 */
export function usePrototypeReviews(projectName: string, prototypes: readonly AppPrototype[] | undefined): PrototypeReviews {
  const [sessions, setSessions] = useState<Readonly<Record<string, ReviewSession>>>({});

  // Follow the prototypes in the render that sees them, so a revision that lands is never drawn half-followed.
  let followed = sessions;
  for (const p of prototypes ?? []) {
    const before = followed[p.component] ?? NEW_SESSION;
    const after = follow(before, p);
    if (after !== before) followed = { ...followed, [p.component]: after };
  }
  if (followed !== sessions) setSessions(followed);

  useEffect(
    () =>
      chatStore.onTurnEnd((project, outcome) => {
        if (project !== projectName) return;
        setSessions((all) => Object.fromEntries(Object.entries(all).map(([c, s]) => [c, turnEnded(s, outcome)])));
      }),
    [projectName],
  );

  const change = (component: string, fn: (s: ReviewSession) => ReviewSession) =>
    setSessions((all) => ({ ...all, [component]: fn(all[component] ?? NEW_SESSION) }));
  return {
    session: (component) => followed[component] ?? NEW_SESSION,
    onQueue: (component, update) => change(component, (s) => ({ ...s, queue: update(s.queue) })),
    onSent: (component, feedback) => change(component, (s) => sendStarted(s, feedback)),
    onNoticeSeen: (component) => change(component, (s) => ({ ...s, notice: null })),
  };
}
