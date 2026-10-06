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

import { useEffect, useRef } from "react";

export interface ReviewKeys {
  /** Escape: undo the nearest thing (the bubble, then the selection); false when there is nothing, so the review closes. */
  onEscape: () => boolean;
  /** C: toggle Annotate. */
  onToggleAnnotate: () => void;
}

/** Whether the key was typed into something that takes text (the bubble's input, a picker). */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * The review's keys, wherever focus is in the console's document: C toggles
 * Annotate, and Escape undoes the bubble, then the selection, before the
 * review's dialog closes on it. Listened for on the way down (capture), so a
 * consumed Escape never reaches the dialog. A key aimed at the prototype's
 * frame is the prototype's: the frame reports an unused Escape itself.
 */
export function useReviewKeys(keys: ReviewKeys): void {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLIFrameElement || e.defaultPrevented) return;
      if (e.key === "Escape") {
        if (latest.current.onEscape()) e.stopPropagation();
      } else if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        latest.current.onToggleAnnotate();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
