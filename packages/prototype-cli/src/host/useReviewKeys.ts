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
 * The review's keys on the host page: C toggles Annotate (not while typing),
 * and Escape undoes the nearest thing (the bubble, then the selection). A key
 * while focus is inside the prototype's frame is the prototype's: the frame
 * reports an Escape it did not use itself (`PrototypeFrame.onEscape`).
 */

import { useEffect, useRef } from "react";

export interface ReviewKeys {
  /** Escape: undo the nearest thing; false when there was nothing to undo. */
  onEscape: () => boolean;
  /** C: toggle Annotate. */
  onToggleAnnotate: () => void;
}

/** Whether the key was typed into something that takes text (a bubble's input, a picker). */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function useReviewKeys(keys: ReviewKeys | null): void {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const keys = latest.current;
      if (!keys || e.target instanceof HTMLIFrameElement || e.defaultPrevented) return;
      if (e.key === "Escape") {
        if (keys.onEscape()) e.preventDefault();
      } else if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        keys.onToggleAnnotate();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
