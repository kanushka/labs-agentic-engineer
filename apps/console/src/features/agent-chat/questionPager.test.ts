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

import { describe, expect, it } from "vitest";
import type { AskQuestionInput, QuestionAnswer } from "@aep/agent-stream";
import { advancesOnPick, answerSummary, nextPage, pageAfterPick, previousPage } from "./questionPager";

const SINGLE: AskQuestionInput = {
  question: "Who approves a claim?",
  options: [
    { label: "The manager", recommended: true },
    { label: "Finance" },
    { label: "Other", freeText: true },
  ],
};
const MULTI: AskQuestionInput = {
  question: "Which channels notify?",
  options: [{ label: "In-app" }, { label: "Email" }],
  multiSelect: true,
};
const FREE: AskQuestionInput = { question: "Anything else?", options: [] };

const none: QuestionAnswer = { selected: [] };
const picked = (label: string): QuestionAnswer => ({ selected: [label] });

describe("advancesOnPick", () => {
  it("moves on when a single-choice option is picked", () => {
    expect(advancesOnPick(SINGLE, picked("Finance"), "Finance")).toBe(true);
  });

  it("stays when the pick cleared the option", () => {
    expect(advancesOnPick(SINGLE, none, "Finance")).toBe(false);
  });

  it("stays on a free-text escape: the real answer is still to be typed", () => {
    expect(advancesOnPick(SINGLE, picked("Other"), "Other")).toBe(false);
  });

  it("stays on a multi-choice question, which moves on with Next", () => {
    expect(advancesOnPick(MULTI, picked("Email"), "Email")).toBe(false);
  });
});

describe("pageAfterPick", () => {
  const qs = [SINGLE, SINGLE, SINGLE];

  it("goes to the next unanswered question after the one just answered", () => {
    expect(pageAfterPick(qs, [picked("Finance"), none, none], 0)).toBe(1);
  });

  it("skips questions already answered", () => {
    expect(pageAfterPick(qs, [picked("Finance"), picked("Finance"), none], 0)).toBe(2);
  });

  it("wraps to an earlier unanswered question", () => {
    expect(pageAfterPick(qs, [none, picked("Finance"), picked("Finance")], 2)).toBe(0);
  });

  it("goes to the answers once every question is answered", () => {
    expect(pageAfterPick(qs, [picked("Finance"), picked("Finance"), picked("Finance")], 1)).toBe("answers");
  });

  it("counts a free-text escape with nothing typed as unanswered", () => {
    expect(pageAfterPick(qs, [picked("Finance"), picked("Other"), none], 2)).toBe(1);
  });
});

describe("nextPage / previousPage", () => {
  it("walks the questions, then the answers", () => {
    expect(nextPage(3, 0)).toBe(1);
    expect(nextPage(3, 2)).toBe("answers");
    expect(nextPage(3, "answers")).toBe("answers");
  });

  it("walks back from the answers to the last question, and stops at the first", () => {
    expect(previousPage(3, "answers")).toBe(2);
    expect(previousPage(3, 1)).toBe(0);
    expect(previousPage(3, 0)).toBe(0);
  });
});

describe("answerSummary", () => {
  it("is null for an unanswered question", () => {
    expect(answerSummary(SINGLE, none)).toBeNull();
    expect(answerSummary(SINGLE, picked("Other"))).toBeNull();
  });

  it("names the picked options", () => {
    expect(answerSummary(MULTI, { selected: ["In-app", "Email"] })).toBe("In-app, Email");
  });

  it("quotes the user's own words, after any pick", () => {
    expect(answerSummary(SINGLE, { selected: ["Finance"], freeText: " over 500 only " })).toBe("Finance · “over 500 only”");
    expect(answerSummary(FREE, { selected: [], freeText: "No" })).toBe("“No”");
  });

  it("drops a free-text escape's label once the words are typed", () => {
    expect(answerSummary(SINGLE, { selected: ["Other"], freeText: "The CFO" })).toBe("“The CFO”");
  });
});
