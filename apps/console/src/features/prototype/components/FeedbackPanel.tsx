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

import { Alert, Box, Button, IconButton, Tooltip, Typography } from "@wso2/oxygen-ui";
import { Trash2 } from "@wso2/oxygen-ui-icons-react";
import type { FeedbackRequest } from "@wso2/prototype-kit/feedback";

export interface FeedbackPanelProps {
  /** Whether a click in the prototype comments (Annotate) rather than acts. */
  annotating: boolean;
  requests: readonly FeedbackRequest[];
  /** The queue was started on a revision that has since been replaced. */
  stale: boolean;
  /** Why the last Send all did not go; the queue is kept. */
  refused: string | null;
  sending: boolean;
  onRemove: (index: number) => void;
  onSend: () => void;
}

/**
 * Annotate's side panel: the queue (numbered as the pins on the prototype
 * are), and Send all, which sends every request to the chat as one revision.
 * Comments are written in the bubble an Annotate click opens at the element.
 */
export function FeedbackPanel({ annotating, requests, stale, refused, sending, onRemove, onSend }: FeedbackPanelProps) {
  return (
    <Box
      component="aside"
      aria-label="Requests"
      sx={{
        width: 340,
        flexShrink: 0,
        borderLeft: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        p: 2,
        overflowY: "auto",
      }}
    >
      <Typography component="h2" sx={{ fontSize: "1rem", fontWeight: 600 }}>
        Requests
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {annotating ? "Click an element in the prototype to comment on it." : "Switch to Annotate to comment on elements."}
      </Typography>
      {stale && requests.length > 0 && (
        <Alert severity="warning" role="note">
          Queued on an earlier version of the prototype.
        </Alert>
      )}
      <Box component="ol" aria-label="Queued requests" sx={{ m: 0, pl: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
        {requests.map((r, i) => (
          <Box
            component="li"
            key={i}
            sx={{ display: "flex", gap: 1, alignItems: "flex-start", border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.25 }}
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
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {r.text}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                {r.screenId}
                {r.elementIds.length > 0 ? ` · ${r.elementIds.join(", ")}` : " · whole screen"}
              </Typography>
            </Box>
            <Tooltip title="Remove">
              <IconButton size="small" aria-label={`Remove request ${i + 1}`} onClick={() => onRemove(i)}>
                <Trash2 size={16} />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Box>
      {refused && (
        <Alert severity="warning" role="alert">
          {refused}
        </Alert>
      )}
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" onClick={onSend} disabled={requests.length === 0 || sending}>
        {`Send all (${requests.length})`}
      </Button>
    </Box>
  );
}
