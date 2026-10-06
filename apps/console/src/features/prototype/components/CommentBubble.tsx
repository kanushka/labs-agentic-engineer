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

import { useMemo, useState, type KeyboardEvent } from "react";
import { Alert, Box, Button, ClickAwayListener, Paper, Popper, TextField, Typography } from "@wso2/oxygen-ui";
import type { HostRect } from "@wso2/prototype-kit/host";
import { MAX_FEEDBACK_REQUESTS, MAX_FEEDBACK_TEXT } from "@wso2/prototype-kit/feedback";

export interface CommentBubbleProps {
  /** Where the commented elements are in the console's viewport (the kit's frame anchors); nothing is drawn until the frame says. */
  anchor: HostRect | null;
  /** The commented elements' labels, in selection order. */
  labels: readonly string[];
  /** The queue holds the contract's most requests: another cannot be added. */
  full: boolean;
  onAdd: (text: string) => void;
  /** The reviewer dismissed the bubble (Escape, or a click away from an empty one). */
  onClose: () => void;
}

/** The anchor as the element Popper places by: a virtual one, since the element itself is inside the sandboxed frame. */
function virtualElement({ top, left, width, height }: HostRect) {
  const rect = { top, left, width, height, x: left, y: top, right: left + width, bottom: top + height };
  return { getBoundingClientRect: () => ({ ...rect, toJSON: () => rect }) };
}

/**
 * The comment bubble an Annotate click opens next to the element (#885):
 * drawn by the console over the frame, never inside it, so typed text stays
 * out of the untrusted prototype. It names the elements it points at; Add or
 * Cmd/Ctrl+Enter queues the comment. The contract's limits hold here: the
 * comment's length (counted near the limit), and the queue's.
 */
export function CommentBubble({ anchor, labels, full, onAdd, onClose }: CommentBubbleProps) {
  const [text, setText] = useState("");
  const anchorEl = useMemo(() => (anchor ? virtualElement(anchor) : null), [anchor]);
  const empty = text.trim() === "";
  const add = () => {
    if (full || empty) return;
    onAdd(text.trim());
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // The bubble is the nearest thing Escape undoes; the review stays open.
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      add();
    }
  };
  const name = labels.join(", ");
  return (
    <Popper
      open={anchorEl !== null}
      anchorEl={anchorEl}
      placement="bottom-start"
      // Inside the review's dialog, so its focus trap keeps focus in the bubble.
      disablePortal
      popperOptions={{ strategy: "fixed" }}
      modifiers={[{ name: "offset", options: { offset: [0, 8] } }]}
      sx={{ zIndex: (t) => t.zIndex.modal + 1 }}
    >
      <ClickAwayListener onClickAway={() => empty && onClose()}>
        <Paper
          role="dialog"
          aria-label={`Comment on ${name}`}
          onKeyDown={onKeyDown}
          sx={{ width: 320, p: 1.5, display: "flex", flexDirection: "column", gap: 1, boxShadow: "var(--aep-shell-card-shadow)" }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {name}
          </Typography>
          <TextField
            label="Comment"
            multiline
            minRows={2}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            slotProps={{ htmlInput: { maxLength: MAX_FEEDBACK_TEXT } }}
            helperText={text.length > MAX_FEEDBACK_TEXT - 200 ? `${text.length} / ${MAX_FEEDBACK_TEXT}` : undefined}
          />
          {full && (
            <Alert severity="info" role="note">
              {`The queue is full (${MAX_FEEDBACK_REQUESTS} comments): send it or remove one to add another.`}
            </Alert>
          )}
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="contained" size="small" onClick={add} disabled={full || empty}>
              Add
            </Button>
          </Box>
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}
