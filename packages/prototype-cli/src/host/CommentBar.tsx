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
 * The floating comment bar at the bottom of the review (Annotate's only
 * panel): how many comments are queued, an expandable list of them across
 * screens, roles and states (an entry goes there and opens it), Comment on
 * screen, and Save feedback, which writes them to the feedback file for the
 * agent.
 */

import { useId, useState, type Ref } from "react";
import { MAX_FEEDBACK_REQUESTS, type FeedbackRequest } from "@wso2/prototype-kit/feedback";
import type { PrototypeManifest } from "@wso2/prototype-kit/host";

export interface CommentBarProps {
  manifest: PrototypeManifest;
  requests: readonly FeedbackRequest[];
  /** The queue was started on a revision that has since been replaced. */
  stale: boolean;
  onCommentOnScreen: () => void;
  /** Go to where the `index`th (0-based) comment was made and open it. */
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
  /** Write the queue to the feedback file; resolves to what to tell the reviewer. */
  onSave: () => Promise<string>;
  /** The bar's element: a whole-screen comment's bubble points at it. */
  ref?: Ref<HTMLElement> | undefined;
}

function nameOf(list: readonly { id: string; name: string }[], id: string): string {
  return list.find((x) => x.id === id)?.name ?? id;
}

/** Where a comment was made, as the reviewer reads it: screen · role · state · its elements (or the whole screen). */
function placeOf(manifest: PrototypeManifest, r: FeedbackRequest): string {
  const on = r.elementIds.length > 0 ? r.elementIds.join(", ") : "Whole screen";
  return [nameOf(manifest.screens, r.screenId), nameOf(manifest.roles, r.roleId), nameOf(manifest.states, r.stateId), on].join(" · ");
}

export function count(n: number): string {
  return `${n} ${n === 1 ? "comment" : "comments"}`;
}

export function CommentBar({ manifest, requests, stale, onCommentOnScreen, onOpen, onRemove, onSave, ref }: CommentBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const listId = useId();
  const full = requests.length >= MAX_FEEDBACK_REQUESTS;
  const save = () => {
    setStatus("Saving…");
    onSave().then(setStatus, (e: unknown) => setStatus(`Not saved: ${e instanceof Error ? e.message : String(e)}`));
  };
  return (
    <section ref={ref} className="ph-bar" aria-label="Comments">
      {expanded && (
        <ol id={listId} className="ph-bar-list" aria-label="Queued comments">
          {requests.length === 0 && <li className="ph-bar-empty">No comments yet. Switch to Annotate and click an element, or comment on the whole screen.</li>}
          {requests.map((r, i) => (
            <li key={i}>
              <button type="button" className="ph-bar-entry" onClick={() => onOpen(i)}>
                <span className="ph-badge" aria-hidden>
                  {i + 1}
                </span>
                <span>
                  <span className="ph-bar-text">{r.text}</span>
                  <small>{placeOf(manifest, r)}</small>
                </span>
              </button>
              <button type="button" className="ph-bar-remove" aria-label={`Remove comment ${i + 1}`} title="Remove" onClick={() => onRemove(i)}>
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      {stale && requests.length > 0 && <p role="note">Queued on an earlier version of the prototype.</p>}
      {full && <p role="note">{`The queue is full (${MAX_FEEDBACK_REQUESTS} comments): save it or remove one to add another.`}</p>}
      {status && <p role="status">{status}</p>}
      <div className="ph-bar-row">
        <button type="button" className="ph-bar-count" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} onClick={() => setExpanded((e) => !e)}>
          {count(requests.length)}
          <span className="ph-caret" aria-hidden>
            {expanded ? "▾" : "▴"}
          </span>
        </button>
        <span className="ph-spacer" />
        <button type="button" onClick={onCommentOnScreen} disabled={full}>
          Comment on screen
        </button>
        <button type="button" className="ph-primary" onClick={save} disabled={requests.length === 0}>
          Save feedback
        </button>
      </div>
    </section>
  );
}
