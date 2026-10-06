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

import { forwardRef, useId, useState } from "react";
import { Alert, Box, Button, ButtonBase, CircularProgress, Divider, IconButton, Paper, Tooltip, Typography } from "@wso2/oxygen-ui";
import { ChevronDown, ChevronUp, MessageSquarePlus, Send, Trash2 } from "@wso2/oxygen-ui-icons-react";
import type { PrototypeManifest } from "@wso2/prototype-kit/host";
import { MAX_FEEDBACK_REQUESTS, targetLabel, type FeedbackRequest } from "@wso2/prototype-kit/feedback";
import { commentCount } from "../model/feedback";

export interface SendBarProps {
  manifest: PrototypeManifest;
  requests: readonly FeedbackRequest[];
  /** Each visited screen's element labels, by key, which the list names a comment's elements by. */
  labels: ScreenLabels;
  /** The comments (0-based) written on an earlier revision than the one showing. */
  earlier: readonly number[];
  /** Why the last Send did not go; the queue is kept. */
  refused: string | null;
  sending: boolean;
  /** The agent is revising the prototype, working on this many sent comments; null when it is not. Send waits meanwhile. */
  revising: number | null;
  /** Why the last revision did not land (its comments are back in the queue); Retry sends the queue again. */
  failed: string | null;
  /** The comments (0-based) whose elements the revision showing no longer draws on this screen. */
  orphans: readonly number[];
  onSend: () => void;
  /** Keep the `index`th comment as a comment on its whole screen. */
  onKeepOnScreen: (index: number) => void;
  onCommentOnScreen: () => void;
  /** Go to where the `index`th comment was made and open it. */
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
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

/**
 * The review's floating send bar (#885), in place of a side panel so the
 * prototype has the full width: the comment count, Comment on screen (a
 * whole-screen comment, its bubble anchored here), Send to agent, and a list
 * of every queued comment across screens, roles and states, whose entries go
 * where the comment was made and open it. The ref is the bar itself, which a
 * whole-screen comment's bubble anchors to.
 */
export const SendBar = forwardRef<HTMLDivElement, SendBarProps>(function SendBar(
  { manifest, requests, labels, earlier, refused, sending, revising, failed, orphans, onSend, onKeepOnScreen, onCommentOnScreen, onOpen, onRemove },
  ref,
) {
  const [expanded, setExpanded] = useState(false);
  const full = requests.length >= MAX_FEEDBACK_REQUESTS;
  const blocked = requests.length === 0 || requests.length > MAX_FEEDBACK_REQUESTS || sending || revising !== null;
  const listId = useId();
  return (
    <Paper
      ref={ref}
      component="section"
      aria-label="Comments"
      sx={{
        width: "min(560px, calc(100% - 32px))",
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        boxShadow: "var(--aep-shell-card-shadow)",
        overflow: "hidden",
      }}
    >
      {expanded && (
        <>
          <Box
            component="ol"
            id={listId}
            aria-label="Queued comments"
            sx={{ m: 0, p: 1, listStyle: "none", maxHeight: "40vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 0.5 }}
          >
            {requests.length === 0 && (
              <Typography component="li" variant="body2" color="text.secondary" sx={{ p: 1 }}>
                No comments yet. Switch to Annotate and click an element, or comment on the whole screen.
              </Typography>
            )}
            {requests.map((r, i) => (
              <Box component="li" key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
                <ButtonBase
                  onClick={() => onOpen(i)}
                  sx={{ flex: 1, minWidth: 0, display: "flex", gap: 1, alignItems: "flex-start", justifyContent: "flex-start", textAlign: "left", borderRadius: 1.5, p: 1, "&:hover": { bgcolor: "action.hover" } }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {i + 1}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {r.text}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {placeOf(manifest, labels, r)}
                    </Typography>
                    {earlier.includes(i) && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        Written on an earlier version
                      </Typography>
                    )}
                    {orphans.includes(i) && (
                      <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
                        Element no longer on this screen
                      </Typography>
                    )}
                  </Box>
                </ButtonBase>
                {orphans.includes(i) && (
                  <Button size="small" onClick={() => onKeepOnScreen(i)} sx={{ textTransform: "none", flexShrink: 0, mt: 0.5 }}>
                    Keep as screen comment
                  </Button>
                )}
                <Tooltip title="Remove">
                  <IconButton size="small" aria-label={`Remove comment ${i + 1}`} onClick={() => onRemove(i)} sx={{ mt: 0.5 }}>
                    <Trash2 size={16} />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
          <Divider />
        </>
      )}
      {earlier.length > 0 && (
        <Alert severity="warning" role="note" sx={{ borderRadius: 0 }}>
          {`${commentCount(earlier.length)} ${earlier.length === 1 ? "was" : "were"} written on an earlier version of the prototype.`}
        </Alert>
      )}
      {orphans.length > 0 && (
        <Alert severity="warning" role="note" sx={{ borderRadius: 0 }}>
          {`${commentCount(orphans.length)} ${orphans.length === 1 ? "points" : "point"} at an element no longer on this screen.`}
        </Alert>
      )}
      {failed && (
        <Alert
          severity="error"
          role="alert"
          sx={{ borderRadius: 0 }}
          action={
            <Button color="inherit" size="small" onClick={onSend} disabled={blocked}>
              Retry
            </Button>
          }
        >
          {failed}
        </Alert>
      )}
      {full && (
        <Alert severity="info" role="note" sx={{ borderRadius: 0 }}>
          {`The queue is full (${MAX_FEEDBACK_REQUESTS} comments): send it or remove one to add another.`}
        </Alert>
      )}
      {refused && (
        <Alert severity="warning" role="alert" sx={{ borderRadius: 0 }}>
          {refused}
        </Alert>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.75 }}>
        <Button
          size="small"
          color="inherit"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          endIcon={expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          onClick={() => setExpanded((e) => !e)}
          sx={{ textTransform: "none", fontWeight: 600 }}
        >
          {commentCount(requests.length)}
        </Button>
        {revising !== null && (
          <Typography variant="body2" color="text.secondary" role="status" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={14} aria-hidden />
            {revising > 0 ? `Agent is revising… (${commentCount(revising)})` : "Agent is revising…"}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<MessageSquarePlus size={16} />} onClick={onCommentOnScreen} disabled={full} sx={{ textTransform: "none" }}>
          Comment on screen
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<Send size={16} />}
          onClick={onSend}
          disabled={blocked}
          sx={{ textTransform: "none" }}
        >
          Send to agent
        </Button>
      </Box>
    </Paper>
  );
});
