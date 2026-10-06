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
 * The preview host: the live prototype in a browser window, the review
 * controls, the findings overlay and (in preview) Annotate: comment bubbles
 * at the elements, pins that open them again, and the comment bar that saves
 * the feedback file.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  PrototypeFrame,
  PrototypeWindow,
  frameViewOf,
  initialReview,
  reduceReview,
  useCommentDraft,
  useFrameAnchors,
  useReviewKeys,
  type DataSnapshot,
  type PrototypeFrameHandle,
  type PrototypeManifest,
  type QueueUpdate,
  type ReviewEvent,
} from "@wso2/prototype-kit/host";
import {
  EMPTY_FEEDBACK_QUEUE,
  MAX_FEEDBACK_REQUESTS,
  dequeue,
  draftOfPin,
  draftPinsOnScreen,
  editRequest,
  enqueue,
  pinsOnScreen,
  requestFor,
  submissionOf,
  type FeedbackQueue,
} from "@wso2/prototype-kit/feedback";
import { FEEDBACK_PATH } from "../feedback.js";
import type { HostConfig, PrototypeRevision } from "../host-config.js";
import { CommentBar, count } from "./CommentBar.js";
import { CommentBubble } from "./CommentBubble.js";
import { FindingsOverlay } from "./FindingsOverlay.js";
import { useLivePrototype } from "./live.js";
import { clearSnapshot, loadSnapshot, saveSnapshot } from "./persistence.js";
import { HOST_CSS } from "./styles.js";
import { QueuedCommentBubble } from "./QueuedCommentBubble.js";
import { Toolbar } from "./Toolbar.js";

export function App({ config }: { config: HostConfig }) {
  const live = useLivePrototype(config);
  const waiting = live.error ?? (live.findings.length > 0 ? "The prototype has check findings; it shows once they are fixed." : "Loading the prototype…");
  return (
    <div className="ph-app">
      <style>{HOST_CSS}</style>
      {live.revision && live.runtime ? <Review config={config} runtime={live.runtime} revision={live.revision} /> : <p className="ph-waiting">{waiting}</p>}
      {live.findings.length > 0 && <FindingsOverlay findings={live.findings} showingLastGood={live.revision !== null} />}
    </div>
  );
}

function screenName(manifest: PrototypeManifest, screenId: string): string {
  return manifest.screens.find((x) => x.id === screenId)?.name ?? screenId;
}

function Review({ config, runtime, revision }: { config: HostConfig; runtime: string; revision: PrototypeRevision }) {
  const { manifest } = revision;
  const [state, setState] = useState(() => ({ manifest, review: initialReview(manifest) }));
  // A replaced manifest repairs the view in the same render, so the frame is never sent a view naming a screen the new manifest lacks.
  let current = state;
  if (state.manifest !== manifest) {
    current = { manifest, review: reduceReview(manifest, state.review, { type: "MANIFEST_REPLACED", manifest }) };
    setState(current);
  }
  const { view, bubble } = current.review;
  const dispatch = useCallback((event: ReviewEvent) => setState((s) => ({ ...s, review: reduceReview(s.manifest, s.review, event) })), []);

  // Annotate (preview only): the screen's element labels, the comment queue with its drafts, and their pins.
  const annotate = config.mode === "preview";
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<FeedbackQueue>(EMPTY_FEEDBACK_QUEUE);
  const onQueue = useCallback((update: QueueUpdate) => setQueue(update), []);
  const { requests } = queue;
  const pins = useMemo(() => pinsOnScreen(requests, view.screenId), [requests, view.screenId]);
  const drafts = useMemo(() => draftPinsOnScreen(queue, view.screenId), [queue, view.screenId]);
  const frameView = useMemo(() => frameViewOf(view, pins, drafts), [view, pins, drafts]);
  const frame = useRef<PrototypeFrameHandle>(null);
  const draft = useCommentDraft({ review: current.review, queue, onQueue });
  const anchors = useFrameAnchors();
  // The comment bar, which a whole-screen comment's bubble points at.
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const full = requests.length >= MAX_FEEDBACK_REQUESTS;
  const opened = bubble?.on === "comment" ? requests[bubble.index] : undefined;
  const labelsOf = (keys: readonly string[]) => keys.map((k) => labels[k] ?? k);

  /** Keyboard focus back into the prototype, on the element a bubble was on (or the pin that opened it). */
  const focusBack = (key: string | undefined, requests?: readonly number[]) => {
    if (key !== undefined) frame.current?.focusElement(key, requests);
  };
  /** Escape, wherever it came from: the bubble, then the selection; false when there was neither. */
  const escape = () => {
    if (bubble) {
      if (bubble.on === "selection") focusBack(view.selectedKeys[0]);
      else if (bubble.on === "comment" && bubble.pin) focusBack(bubble.pin.key, bubble.pin.requests);
      dispatch({ type: "CLOSE_BUBBLE" });
    } else if (view.selectedKeys.length > 0) dispatch({ type: "CLEAR_SELECTION" });
    else return false;
    return true;
  };
  useReviewKeys(annotate ? { onEscape: escape, onToggleAnnotate: () => dispatch({ type: view.mode === "annotate" ? "EXIT_ANNOTATE" : "ENTER_ANNOTATE" }) } : null);

  const add = (text: string) => {
    // The feedback is given against the revision showing when its first comment was queued.
    onQueue((q) => enqueue(q, revision.hash, requestFor(view, text)));
    // Added, the comment is no longer a draft to keep.
    draft.setText("");
    focusBack(view.selectedKeys[0]);
    dispatch({ type: "CLEAR_SELECTION" });
  };
  const remove = (index: number) => {
    // An open comment's number would shift under it; its pin goes, so focus goes to its element.
    if (bubble?.on === "comment") {
      focusBack(bubble.pin?.key);
      dispatch({ type: "CLOSE_BUBBLE" });
    }
    onQueue((q) => dequeue(q, index));
  };
  /** A pin in the frame: a queued comment's opens it; a draft pin reopens the draft on its elements (in Annotate). */
  const openPin = (key: string, numbers: number[]) => {
    if (!annotate) return;
    if (numbers.length === 0) {
      const kept = draftOfPin(queue, view.screenId, key);
      if (kept) dispatch({ type: "SELECT_ELEMENTS", elementKeys: kept.elementIds });
      return;
    }
    const index = (numbers[0] ?? 0) - 1;
    if (requests[index]) dispatch({ type: "OPEN_PIN", index, pin: { key, requests: numbers } });
  };
  const open = (index: number) => {
    const request = requests[index];
    if (request) dispatch({ type: "OPEN_COMMENT", index, request });
  };
  const save = async () => {
    const submission = submissionOf(queue);
    if (!submission) throw new Error("there are no comments to save");
    const response = await fetch("feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(submission) });
    if (!response.ok) throw new Error(await response.text());
    return `Saved ${count(submission.requests.length)} to ${FEEDBACK_PATH}`;
  };

  // Mock data: persisted per revision when --persist is on; Reset starts from the seed.
  const persist = config.mode === "preview" && config.persist;
  const initialData = useMemo(() => (persist ? loadSnapshot(revision.hash) : undefined), [persist, revision.hash]);
  const [resetToken, setResetToken] = useState(0);
  const onData = useCallback((data: DataSnapshot) => persist && saveSnapshot(revision.hash, data), [persist, revision.hash]);
  const reset = () => {
    clearSnapshot(revision.hash);
    setResetToken((t) => t + 1);
  };

  return (
    <>
      <Toolbar manifest={manifest} view={view} dispatch={dispatch} onReset={reset} annotate={annotate} />
      <div className={annotate ? "ph-body ph-body-annotate" : "ph-body"}>
        <PrototypeWindow title={manifest.name} manifest={manifest} view={view}>
          <PrototypeFrame
            ref={frame}
            title={manifest.name}
            runtime={runtime}
            manifest={manifest}
            source={revision.source}
            version={revision.hash}
            view={frameView}
            initialData={initialData}
            resetToken={resetToken}
            onNavigate={(screenId) => {
              // The frame is untrusted: only Preview navigates (the reducer checks the target against the role).
              if (view.mode === "preview") dispatch({ type: "NAVIGATE", screenId });
            }}
            onToggle={(elementKey, additive) => {
              if (additive) draft.carryNext();
              dispatch({ type: additive ? "TOGGLE_SELECTION" : "SELECT_ONLY", elementKey });
            }}
            onPin={openPin}
            onGeometry={anchors.onGeometry}
            onEscape={escape}
            onElements={(_screenId, elements) => setLabels(Object.fromEntries(elements.map((e) => [e.key, e.label])))}
            onData={onData}
          />
        </PrototypeWindow>
        {annotate && (bubble?.on === "selection" || bubble?.on === "screen") && (
          <CommentBubble
            // A new bubble (another selection, or the screen) starts afresh.
            key={bubble.on}
            anchor={bubble.on === "screen" ? bar : anchors.anchor(view.selectedKeys)}
            labels={bubble.on === "screen" ? [`${screenName(manifest, view.screenId)} (whole screen)`] : labelsOf(view.selectedKeys)}
            full={full}
            text={draft.text}
            onText={draft.setText}
            onAdd={add}
            // Typed text is kept as a draft where it was written.
            onClose={() => dispatch({ type: "CLOSE_BUBBLE" })}
          />
        )}
        {annotate && bubble?.on === "comment" && opened && (
          <QueuedCommentBubble
            key={bubble.index}
            anchor={opened.elementIds.length > 0 ? anchors.anchor(opened.elementIds) : bar}
            number={bubble.index + 1}
            request={opened}
            on={opened.elementIds.length > 0 ? labelsOf(opened.elementIds).join(", ") : "Whole screen"}
            onEdit={(text) => onQueue((q) => editRequest(q, bubble.index, text))}
            onRemove={() => remove(bubble.index)}
            onClose={() => dispatch({ type: "CLOSE_BUBBLE" })}
          />
        )}
        {annotate && (
          <CommentBar
            ref={setBar}
            manifest={manifest}
            requests={requests}
            stale={queue.hash !== null && queue.hash !== revision.hash}
            onCommentOnScreen={() => dispatch({ type: "COMMENT_ON_SCREEN" })}
            onOpen={open}
            onRemove={remove}
            onSave={save}
          />
        )}
      </div>
    </>
  );
}
