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

import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { ClickAwayListener, Paper, Popper } from "@wso2/oxygen-ui";
import type { HostRect } from "@wso2/prototype-kit/host";

/**
 * Where a bubble points: elements in the frame (the kit's frame anchors, in
 * the console's viewport), or an element of the console's own (the send bar,
 * for a whole-screen comment).
 */
export type BubbleAnchor = HostRect | HTMLElement;

/** A frame rectangle as the element Popper places by: a virtual one, since the element itself is inside the sandboxed frame. */
function virtualElement({ top, left, width, height }: HostRect) {
  const rect = { top, left, width, height, x: left, y: top, right: left + width, bottom: top + height };
  return { getBoundingClientRect: () => ({ ...rect, toJSON: () => rect }) };
}

/**
 * The popover every comment bubble is drawn in, by its anchor (flipping
 * above it when there is no room below), over the frame and never inside it.
 * Nothing is drawn until the anchor is known.
 */
export function AnchoredBubble({
  anchor,
  label,
  onClickAway,
  onKeyDown,
  children,
}: {
  anchor: BubbleAnchor | null;
  /** The bubble's accessible name. */
  label: string;
  onClickAway: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const anchorEl = useMemo(() => (anchor === null || anchor instanceof HTMLElement ? anchor : virtualElement(anchor)), [anchor]);
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
      <ClickAwayListener onClickAway={onClickAway}>
        <Paper
          role="dialog"
          aria-label={label}
          onKeyDown={onKeyDown}
          sx={{ width: 320, p: 1.5, display: "flex", flexDirection: "column", gap: 1, boxShadow: "var(--aep-shell-card-shadow)" }}
        >
          {children}
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}
