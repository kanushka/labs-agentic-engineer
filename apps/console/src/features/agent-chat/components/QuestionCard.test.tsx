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

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import type { AskQuestionInput } from "@aep/agent-stream";
import type { QuestionItem } from "../chatLog";
import { QuestionCard } from "./QuestionCard";

// The question card in the chat (ADR-0002 / #879): a single question is one
// plain card; a batch asks one question at a time and sends from its Answers
// page.

afterEach(cleanup);

const WHO: AskQuestionInput = {
  question: "Who approves a claim?",
  options: [{ label: "The manager", recommended: true }, { label: "Finance" }, { label: "Other", freeText: true }],
};
const NOTIFY: AskQuestionInput = {
  question: "How are people notified?",
  options: [{ label: "In-app only" }, { label: "In-app and email" }],
};
const CATEGORIES: AskQuestionInput = {
  question: "Which categories?",
  options: [{ label: "Travel" }, { label: "Meals" }],
  multiSelect: true,
};

function item(questions: AskQuestionInput[], streaming = false): QuestionItem {
  return { kind: "question", id: "t1:q:c1", turnId: "t1", toolCallId: "c1", questions, streaming };
}

function show(questions: AskQuestionInput[], opts: { streaming?: boolean; sending?: boolean } = {}) {
  const onAnswer = vi.fn();
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <QuestionCard item={item(questions, opts.streaming)} answerable sending={opts.sending ?? false} onAnswer={onAnswer} />
    </OxygenUIThemeProvider>,
  );
  return onAnswer;
}

const card = () => screen.getByRole("region", { name: "The agent's questions" });
const current = () => screen.getByRole("tabpanel");
const tab = (name: string | RegExp) => screen.getByRole("tab", { name });

describe("a single question", () => {
  it("is one plain card, sent from the card itself", () => {
    const onAnswer = show([WHO]);
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Finance/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(onAnswer).toHaveBeenCalledWith([{ selected: ["Finance"] }]);
  });
});

describe("a batch", () => {
  it("shows one question at a time, with a tab per question and the Answers page", () => {
    show([WHO, NOTIFY, CATEGORIES]);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["1", "2", "3", "Answers"]);
    expect(current().textContent).toContain(WHO.question);
    expect(current().textContent).not.toContain(NOTIFY.question);
  });

  it("keeps every page laid out, so the card is as tall as its tallest, but shows only the current one", () => {
    show([WHO, NOTIFY, CATEGORIES]);
    // Three questions and the Answers page, stacked in one grid cell.
    const stacked = current().parentElement!.children;
    expect(stacked).toHaveLength(4);
    const hidden = [...stacked].filter((p) => p !== current());
    expect(hidden.every((p) => p.getAttribute("aria-hidden") === "true" && p.hasAttribute("inert"))).toBe(true);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Finance")]),
    );
    expect(screen.queryByRole("radio", { name: /In-app only/ })).toBeNull();
  });

  it("moves on by itself when a single-choice option is picked, and ticks the tab", () => {
    show([WHO, NOTIFY, CATEGORIES]);
    fireEvent.click(screen.getByRole("radio", { name: /Finance/ }));
    expect(current().textContent).toContain(NOTIFY.question);
    expect(tab("Question 1, answered")).toBeTruthy();
  });

  it("stays on an Other pick, whose answer is still to be typed", () => {
    show([WHO, NOTIFY]);
    fireEvent.click(screen.getByRole("radio", { name: /Other/ }));
    expect(current().textContent).toContain(WHO.question);
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });

  it("stays on a multi-choice question until Next", () => {
    show([CATEGORIES, WHO]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Travel/ }));
    expect(current().textContent).toContain(CATEGORIES.question);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(current().textContent).toContain(WHO.question);
  });

  it("lands on the Answers page once every question is answered, and sends them as one", () => {
    const onAnswer = show([WHO, NOTIFY]);
    fireEvent.click(screen.getByRole("radio", { name: /Finance/ }));
    fireEvent.click(screen.getByRole("radio", { name: /In-app only/ }));
    expect(tab("Answers, all answered").getAttribute("aria-selected")).toBe("true");
    expect(current().textContent).toContain("Finance");
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    expect(onAnswer).toHaveBeenCalledWith([{ selected: ["Finance"] }, { selected: ["In-app only"] }]);
  });

  it("holds Send while a question is unanswered, and says which", () => {
    const onAnswer = show([WHO, NOTIFY]);
    fireEvent.click(tab(/^Answers/));
    expect(tab("Answers")).toBeTruthy();
    expect(current().textContent).toContain("Not answered");
    const send = screen.getByRole("button", { name: "Send answers" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /How are people notified/ }));
    expect(current().textContent).toContain(NOTIFY.question);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("takes keys: a number picks, arrows move, Enter sends from the Answers page", () => {
    const onAnswer = show([WHO, NOTIFY]);
    fireEvent.keyDown(card(), { key: "2" });
    expect(current().textContent).toContain(NOTIFY.question);
    fireEvent.keyDown(current(), { key: "ArrowLeft" });
    expect(current().textContent).toContain(WHO.question);
    fireEvent.keyDown(current(), { key: "ArrowRight" });
    fireEvent.keyDown(current(), { key: "1" });
    expect(tab(/^Answers/).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(current(), { key: "Enter" });
    expect(onAnswer).toHaveBeenCalledWith([{ selected: ["Finance"] }, { selected: ["In-app only"] }]);
  });

  it("leaves keys typed into the own-words box alone", () => {
    show([WHO, NOTIFY]);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "2" });
    expect(current().textContent).toContain(WHO.question);
  });

  it("can be read, not answered, while it is still arriving", () => {
    show([WHO], { streaming: true });
    expect(screen.getByText("Still asking…")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Finance/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
