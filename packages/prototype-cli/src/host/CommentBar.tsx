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
 * The floating comment bar at the bottom of the review (Comment mode's only
 * panel): how many comments are queued, in Comment mode a hint that a click comments, an expandable list of them across
 * screens, roles and states (an entry goes there and opens it), Comment on
 * screen, and Save feedback, which writes them to the feedback file for the
 * agent.
 */

import { useId, useState, type Ref } from "react";
import { MAX_FEEDBACK_REQUESTS, targetLabel, type FeedbackRequest } from "@wso2/prototype-kit/feedback";
import type { PrototypeManifest } from "@wso2/prototype-kit/host";

export interface CommentBarProps {
  manifest: PrototypeManifest;
  requests: readonly FeedbackRequest[];
  /** Each visited screen's element labels, by key, which the list names a comment's elements by. */
  labels: ScreenLabels;
  /** The comments (0-based) written on an earlier revision than the one showing. */
  earlier: readonly number[];
  /** In Comment mode: the bar says a click comments. */
  commenting: boolean;
  onCommentOnScreen: () => void;
  /** Go to where the `index`th (0-based) comment was made and open it. */
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
  /** Write the queue to the feedback file; resolves to what to tell the reviewer. */
  onSave: () => Promise<string>;
  /** The bar's element: a whole-screen comment's bubble points at it. */
  ref?: Ref<HTMLElement> | undefined;
}

/** Element labels by key, per screen id. */
type ScreenLabels = Readonly<Record<string, Readonly<Record<string, string>>>>;

function nameOf(list: readonly { id: string; name: string }[], id: string): string {
  return list.find((x) => x.id === id)?.name ?? id;
}

/** Where a comment was made, as the reviewer reads it: screen · role · state · its elements' labels (or the whole screen). */
function placeOf(manifest: PrototypeManifest, labels: ScreenLabels, r: FeedbackRequest): string {
  const on = targetLabel(r, labels[r.screenId] ?? {});
  return [nameOf(manifest.screens, r.screenId), nameOf(manifest.roles, r.roleId), nameOf(manifest.states, r.stateId), on].join(" · ");
}

export function count(n: number): string {
  return `${n} ${n === 1 ? "comment" : "comments"}`;
}

export function CommentBar({ manifest, requests, labels, earlier, commenting, onCommentOnScreen, onOpen, onRemove, onSave, ref }: CommentBarProps) {
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
          {requests.length === 0 && (
            <li className="ph-bar-empty">
              No comments yet. Press <kbd>C</kbd> or choose Comment, then click anything on the screen. Or comment on the whole screen.
            </li>
          )}
          {requests.map((r, i) => (
            <li key={i}>
              <button type="button" className="ph-bar-entry" onClick={() => onOpen(i)}>
                <span className="ph-badge" aria-hidden>
                  {i + 1}
                </span>
                <span>
                  <span className="ph-bar-text">{r.text}</span>
                  <small>{placeOf(manifest, labels, r)}</small>
                  {earlier.includes(i) && <small>Written on an earlier version</small>}
                </span>
              </button>
              <button type="button" className="ph-bar-remove" aria-label={`Remove comment ${i + 1}`} title="Remove" onClick={() => onRemove(i)}>
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      {earlier.length > 0 && <p role="note">{`${count(earlier.length)} ${earlier.length === 1 ? "was" : "were"} written on an earlier version of the prototype.`}</p>}
      {full && <p role="note">{`The queue is full (${MAX_FEEDBACK_REQUESTS} comments): remove one to add another.`}</p>}
      {status && <p role="status">{status}</p>}
      <div className="ph-bar-row">
        <button type="button" className="ph-bar-count" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} onClick={() => setExpanded((e) => !e)}>
          {count(requests.length)}
          <span className="ph-caret" aria-hidden>
            {expanded ? "▾" : "▴"}
          </span>
        </button>
        {commenting && (
          <span className="ph-bar-hint">
            <i aria-hidden />
            Click anything to comment
          </span>
        )}
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
