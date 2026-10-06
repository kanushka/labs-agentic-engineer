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

import { Box, Button, Typography } from "@wso2/oxygen-ui";
import type { FeedbackRequest } from "@wso2/prototype-kit/feedback";
import { AnchoredBubble, type BubbleAnchor } from "./AnchoredBubble";

/**
 * A queued comment, opened where it was made (from the send bar's list): its
 * number, what it is on, its text, and Remove.
 */
export function QueuedCommentBubble({
  anchor,
  number,
  request,
  on,
  onRemove,
  onClose,
}: {
  anchor: BubbleAnchor | null;
  /** The comment's 1-based number, as its pin and the bar's list show it. */
  number: number;
  request: FeedbackRequest;
  /** What it is on, as the reviewer reads it (element labels, or the whole screen). */
  on: string;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <AnchoredBubble anchor={anchor} label={`Comment ${number}`} onClickAway={onClose}>
      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
        {`${number} · ${on}`}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {request.text}
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button size="small" color="error" onClick={onRemove}>
          Remove
        </Button>
      </Box>
    </AnchoredBubble>
  );
}
