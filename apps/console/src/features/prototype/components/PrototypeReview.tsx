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

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, IconButton, Snackbar, Tooltip, Typography, useColorScheme } from "@wso2/oxygen-ui";
import { X } from "@wso2/oxygen-ui-icons-react";
import {
  PrototypeFrame,
  PrototypeWindow,
  frameViewOf,
  initialReview,
  reduceReview,
  useFrameAnchors,
  type PrototypeFrameHandle,
  type ReviewEvent,
} from "@wso2/prototype-kit/host";
import type { PrototypeFeedback } from "../../agent-chat/turnScope";
import {
  MAX_FEEDBACK_REQUESTS,
  dequeue,
  draftOfPin,
  draftPinsOnScreen,
  editRequest,
  enqueue,
  keepOnScreen,
  orphansOnScreen,
  pinsOnScreen,
  requestFor,
} from "@wso2/prototype-kit/feedback";
import { commentCount, feedbackBatch } from "../model/feedback";
import type { AppPrototype, PrototypeFiles } from "../model/prototypes";
import type { ReviewSession, RevisionNotice } from "../model/revision";
import { useCommentDraft, type QueueUpdate } from "../useCommentDraft";
import { useFrameRuntime, usePrototypeHash } from "../useReviewAssets";
import { useReviewKeys } from "../useReviewKeys";
import { CommentBubble } from "./CommentBubble";
import { QueuedCommentBubble } from "./QueuedCommentBubble";
import { ReviewToolbar } from "./ReviewToolbar";
import { SendBar } from "./SendBar";

export interface PrototypeReviewProps {
  prototype: AppPrototype;
  /**
   * What outlives the overlay: the comments queued and drafted so far, the
   * batch out with the agent, the revision to show (kept while the agent
   * revises it) and what the last revision's end left to say.
   */
  session: ReviewSession;
  onQueue: (update: QueueUpdate) => void;
  /** Whether a turn can start now (the chat is loaded and idle). */
  ready: boolean;
  /** Send the batch as one revision turn; resolves false when it was not sent. */
  onSend: (feedback: PrototypeFeedback) => Promise<boolean>;
  /** The revision showing: the review has looked at it. */
  onSeen: (hash: string) => void;
  /** The notice was seen: the "Updated" toast closed. */
  onNoticeSeen: () => void;
  /** Read what the agent did: the chat, with the review closed. */
  onWhatChanged: () => void;
  onClose: () => void;
}

const BUSY = "The agent is working on another turn, so nothing was sent. Your requests are kept: send them once it finishes.";
const NOT_SENT = "Your requests weren't sent; the chat says why. They are kept: try again.";

function Header({
  titleId,
  title,
  revising,
  onClose,
  children,
}: {
  titleId: string;
  title: string;
  revising: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Box
      component="header"
      sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, px: 2.5, py: 1.25, borderBottom: 1, borderColor: "divider" }}
    >
      <Typography component="h2" id={titleId} sx={{ fontSize: "1rem", fontWeight: 600 }}>
        {title}
      </Typography>
      {revising && <Chip size="small" color="info" label="Revising…" />}
      <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end", minWidth: 0 }}>{children}</Box>
      <Tooltip title="Close (Esc)">
        <IconButton aria-label="Close" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/**
 * Whether the dialog should close for this Escape. Escape with focus in the
 * prototype is the prototype's: the frame reports it (`onEscape`) only when
 * the prototype left it unused. A key this document still gets with the frame
 * element as its target was aimed there, so the dialog leaves it to the frame.
 */
function closesOnEscape(event: { target: EventTarget | null }): boolean {
  return !(event.target instanceof HTMLIFrameElement);
}

/** The console's scheme as it draws now (its mode, or the system's under "system"), for the prototype to match. */
function useResolvedScheme(): "light" | "dark" | undefined {
  const { mode, systemMode } = useColorScheme();
  const resolved = mode === "system" ? systemMode : mode;
  return resolved === "light" || resolved === "dark" ? resolved : undefined;
}

/** The kit's prototype window drawn in the console's theme (light and dark follow the Oxygen palette). */
const WINDOW_LOOK = {
  "--proto-window-border": "var(--oxygen-palette-divider)",
  "--proto-window-radius": "8px",
  "--proto-window-bg": "var(--oxygen-palette-background-paper)",
  "--proto-window-shadow": "var(--oxygen-shadows-2, 0 2px 8px rgba(0,0,0,.15))",
  "--proto-window-bar-bg": "var(--oxygen-palette-action-hover)",
  "--proto-window-bar-border": "var(--oxygen-palette-divider)",
  "--proto-window-fg": "var(--oxygen-palette-text-primary)",
  "--proto-window-dot": "var(--oxygen-palette-action-disabled)",
  "--proto-window-address-bg": "var(--oxygen-palette-background-paper)",
  "--proto-window-address-fg": "var(--oxygen-palette-text-secondary)",
  fontSize: "0.8125rem",
} as const;

function screenName(manifest: PrototypeFiles["manifest"], screenId: string): string {
  return manifest.screens.find((x) => x.id === screenId)?.name ?? screenId;
}

function Waiting({ children }: { children: ReactNode }) {
  return <Box sx={{ flex: 1, display: "grid", placeItems: "center", p: 4 }}>{children}</Box>;
}

/**
 * The full-screen prototype review (spec #860): an Oxygen dialog over the
 * whole console, closed with its X or Escape. It runs the prototype in the
 * kit's sandboxed `PrototypeFrame` on the Oxygen theme's frame runtime; the
 * kit's view reducer owns the pickers and Annotate, so Preview acts and
 * Annotate only selects. A prototype that cannot be shown says why instead of
 * drawing a blank frame.
 */
export function PrototypeReview(props: PrototypeReviewProps) {
  const { prototype, onClose } = props;
  const titleId = useId();
  const runtime = useFrameRuntime();
  const files = props.session.shown;
  const revising = props.session.revising;
  const name = files?.manifest.name ?? prototype.component;

  let body: ReactNode = (
    <Waiting>
      <CircularProgress aria-label="Loading the prototype" />
    </Waiting>
  );
  if (!files) {
    body = (
      <Waiting>
        <Alert severity={prototype.problem ? "error" : "info"} sx={{ maxWidth: "60ch" }}>
          {prototype.problem ??
            (revising ? "The agent is writing this prototype. Follow along in the chat." : "There is no prototype for this web application yet.")}
        </Alert>
      </Waiting>
    );
  } else if (runtime.error) {
    body = (
      <Waiting>
        <Alert severity="error">{`Couldn't load the prototype runtime: ${runtime.error}`}</Alert>
      </Waiting>
    );
  }

  return (
    <Dialog
      fullScreen
      open
      onClose={(event: { target: EventTarget | null }, reason) => {
        if (reason !== "escapeKeyDown" || closesOnEscape(event)) onClose();
      }}
      aria-labelledby={titleId}
    >
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {files && runtime.value ? (
          <Session {...props} titleId={titleId} files={files} runtime={runtime.value} revising={revising} />
        ) : (
          <>
            <Header titleId={titleId} title={`Prototype · ${name}`} revising={revising} onClose={onClose} />
            {body}
          </>
        )}
      </Box>
    </Dialog>
  );
}

function Session({
  titleId,
  prototype,
  files,
  runtime,
  revising,
  session,
  onQueue,
  ready,
  onSend,
  onSeen,
  onNoticeSeen,
  onWhatChanged,
  onClose,
}: PrototypeReviewProps & { titleId: string; files: PrototypeFiles; runtime: string; revising: boolean }) {
  const { queue, notice } = session;
  const hash = usePrototypeHash(files.manifestText, files.source);
  const colorScheme = useResolvedScheme();
  const { manifest } = files;
  useEffect(() => {
    onSeen(hash);
  }, [hash, onSeen]);
  const [state, setState] = useState(() => ({ manifest, review: initialReview(manifest) }));
  // A revision that lands while the review is open repairs the view in the same render, as the kit CLI's host does.
  let current = state;
  if (state.manifest !== manifest) {
    current = { manifest, review: reduceReview(manifest, state.review, { type: "MANIFEST_REPLACED", manifest }) };
    setState(current);
  }
  const { view, bubble } = current.review;
  const dispatch = useCallback(
    (event: ReviewEvent) => setState((s) => ({ ...s, review: reduceReview(s.manifest, s.review, event) })),
    [],
  );

  const { requests } = queue;
  const [labels, setLabels] = useState<Record<string, string>>({});
  // The elements the frame last said its screen draws, which a revision's comments are checked against.
  const [rendered, setRendered] = useState<{ screenId: string; keys: string[] } | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [refused, setRefused] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pins = useMemo(() => pinsOnScreen(requests, view.screenId), [requests, view.screenId]);
  const drafts = useMemo(() => draftPinsOnScreen(queue, view.screenId), [queue, view.screenId]);
  const frameView = useMemo(() => frameViewOf(view, pins, drafts), [view, pins, drafts]);
  const frame = useRef<PrototypeFrameHandle>(null);
  const draft = useCommentDraft({ review: current.review, queue, onQueue });
  const anchors = useFrameAnchors();
  // The send bar, which a whole-screen comment's bubble points at.
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const full = requests.length >= MAX_FEEDBACK_REQUESTS;
  // Comments carried over from an earlier revision may point at elements it took away.
  const stale = queue.hash !== null && queue.hash !== hash;
  const orphans = useMemo(
    () => (stale && rendered?.screenId === view.screenId ? orphansOnScreen(requests, view, rendered.keys) : []),
    [stale, rendered, requests, view],
  );
  const opened = bubble?.on === "comment" ? requests[bubble.index] : undefined;

  /** Keyboard focus back into the prototype, on the element a bubble was on (or the pin that opened it). */
  const focusBack = (key: string | undefined, requests?: readonly number[]) => {
    if (key !== undefined) frame.current?.focusElement(key, requests);
  };
  /** Escape, wherever it came from: the bubble, then the selection, then (false) the review. */
  const escape = () => {
    if (bubble) {
      if (bubble.on === "selection") focusBack(view.selectedKeys[0]);
      else if (bubble.on === "comment" && bubble.pin) focusBack(bubble.pin.key, bubble.pin.requests);
      dispatch({ type: "CLOSE_BUBBLE" });
    } else if (view.selectedKeys.length > 0) dispatch({ type: "CLEAR_SELECTION" });
    else return false;
    return true;
  };
  useReviewKeys({
    onEscape: escape,
    onToggleAnnotate: () => dispatch({ type: view.mode === "annotate" ? "EXIT_ANNOTATE" : "ENTER_ANNOTATE" }),
  });

  const add = (text: string) => {
    onQueue((q) => enqueue(q, hash, requestFor(view, text)));
    // Added, the comment is no longer a draft to keep.
    draft.setText("");
    setRefused(null);
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
  const labelsOf = (keys: readonly string[]) => keys.map((k) => labels[k] ?? k);
  const send = async () => {
    const feedback = feedbackBatch(prototype.component, queue);
    if (!feedback) return;
    if (!ready) {
      setRefused(BUSY);
      return;
    }
    setSending(true);
    const delivered = await onSend(feedback);
    setSending(false);
    setRefused(delivered ? null : NOT_SENT);
  };

  return (
    <>
      <Header titleId={titleId} title={`Prototype · ${manifest.name}`} revising={revising} onClose={onClose}>
        <ReviewToolbar manifest={manifest} view={view} dispatch={dispatch} onReset={() => setResetToken((t) => t + 1)} />
      </Header>
      <Box sx={{ flex: 1, minHeight: 0, position: "relative", display: "flex", bgcolor: "background.default" }}>
        {/* The bottom gutter keeps the floating send bar off the prototype. */}
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", p: 2, pb: 10, ...WINDOW_LOOK }}>
          <PrototypeWindow title={manifest.name} manifest={manifest} view={view}>
            <PrototypeFrame
              ref={frame}
              title={manifest.name}
              runtime={runtime}
              manifest={manifest}
              source={files.source}
              version={hash}
              view={frameView}
              resetToken={resetToken}
              colorScheme={colorScheme}
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
              onEscape={() => escape() || onClose()}
              onElements={(screenId, elements) => {
                setLabels(Object.fromEntries(elements.map((e) => [e.key, e.label])));
                setRendered({ screenId, keys: elements.map((e) => e.key) });
              }}
              loading={
                <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", bgcolor: "background.paper" }}>
                  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
                    <CircularProgress size={28} aria-hidden />
                    <Typography variant="body2" color="text.secondary">
                      Starting the prototype…
                    </Typography>
                  </Box>
                </Box>
              }
            />
          </PrototypeWindow>
          {(bubble?.on === "selection" || bubble?.on === "screen") && (
            <CommentBubble
              // A new bubble (another selection, or the screen) starts empty.
              key={bubble.on}
              anchor={bubble.on === "screen" ? bar : anchors.anchor(view.selectedKeys)}
              labels={bubble.on === "screen" ? [`${screenName(manifest, view.screenId)} (whole screen)`] : labelsOf(view.selectedKeys)}
              full={full}
              text={draft.text}
              onText={draft.setText}
              onAdd={add}
              // Typed text is kept as a draft (useCommentDraft).
              onClose={() => dispatch({ type: "CLOSE_BUBBLE" })}
            />
          )}
          {bubble?.on === "comment" && opened && (
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
        </Box>
        <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 16, display: "flex", justifyContent: "center", pointerEvents: "none", "& > *": { pointerEvents: "auto" } }}>
          <SendBar
            ref={setBar}
            manifest={manifest}
            requests={requests}
            stale={stale}
            refused={refused}
            sending={sending}
            revising={revising ? (session.sent?.feedback.requests.length ?? 0) : null}
            failed={notice?.kind === "failed" ? notice.reason : null}
            orphans={orphans}
            onSend={() => void send()}
            onKeepOnScreen={(index) => onQueue((q) => keepOnScreen(q, index))}
            onCommentOnScreen={() => dispatch({ type: "COMMENT_ON_SCREEN" })}
            onOpen={open}
            onRemove={remove}
          />
        </Box>
      </Box>
      <UpdatedToast notice={notice} onWhatChanged={onWhatChanged} onClose={onNoticeSeen} />
    </>
  );
}

/** "Updated" once a revision landed in the open review, with the way to what the agent did. */
function UpdatedToast({ notice, onWhatChanged, onClose }: { notice: RevisionNotice; onWhatChanged: () => void; onClose: () => void }) {
  const updated = notice?.kind === "updated" ? notice : null;
  return (
    <Snackbar
      open={updated !== null}
      autoHideDuration={8000}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      onClose={(_event, reason) => reason !== "clickaway" && onClose()}
    >
      <Alert
        severity="success"
        variant="filled"
        action={
          <Button color="inherit" size="small" onClick={onWhatChanged}>
            What changed
          </Button>
        }
      >
        {updated && (updated.addressed > 0 ? `Updated · ${commentCount(updated.addressed)} addressed` : "Updated")}
      </Alert>
    </Snackbar>
  );
}
