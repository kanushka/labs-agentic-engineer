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

import type { QuestionAnswer } from "@aep/agent-stream";

// The answers given on the Questions card and not yet sent, per question
// item, for as long as the page lives: closing the card and opening it again
// finds them where they were; a reload starts over (ADR-0002). Each user's
// own: nothing here is shared with the room.

const drafts = new Map<string, QuestionAnswer[]>();

const key = (projectName: string, itemId: string) => `${projectName}\u0000${itemId}`;

export function questionDraft(projectName: string, itemId: string): QuestionAnswer[] {
  return drafts.get(key(projectName, itemId)) ?? [];
}

export function saveQuestionDraft(projectName: string, itemId: string, answers: QuestionAnswer[]): void {
  drafts.set(key(projectName, itemId), answers);
}
