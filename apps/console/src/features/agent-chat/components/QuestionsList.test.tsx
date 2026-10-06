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
import type { ChatItem } from "../chatLog";
import type { ProjectChat } from "../chatStore";

// The Questions card's list (ADR-0002 / #879): every open question at once,
// answerable as they arrive, sent as one message once all are answered.

let chat: ProjectChat;
const answer = vi.fn(async () => true);
vi.mock("../useProjectChat", () => ({ useProjectChat: () => chat, chatStore: { answer } }));

// jsdom lays nothing out, so it has no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const { QuestionsList } = await import("./QuestionsList");

afterEach(() => {
  cleanup();
  answer.mockClear();
});

const WHO: AskQuestionInput = { question: "Who approves a claim?", options: [{ label: "The manager" }, { label: "Finance" }] };
const NOTIFY: AskQuestionInput = { question: "How are people notified?", options: [{ label: "In-app only" }, { label: "Email" }] };

let n = 0;
function show(items: ChatItem[], phase: "idle" | "starting" | "running" = "idle") {
  n += 1;
  chat = {
    status: "ready",
    items,
    turn: phase === "idle" ? { phase } : phase === "starting" ? { phase, instruction: "x" } : { phase, turnId: "t2" },
  } as ProjectChat;
  // A project per render: drafts are kept per project and question.
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <QuestionsList projectName={`acme-${n}`} />
    </OxygenUIThemeProvider>,
  );
}

const batch = (extra: Partial<Extract<ChatItem, { kind: "question" }>> = {}): ChatItem => ({
  kind: "question",
  id: "t1:q:c1",
  turnId: "t1",
  toolCallId: "c1",
  questions: [WHO, NOTIFY],
  streaming: false,
  ...extra,
});

describe("QuestionsList", () => {
  it("lists every question at once, numbered, with no pages", () => {
    show([batch()]);
    expect(screen.getByRole("heading", { name: "Questions for you" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Who approves a claim?"),
      expect.stringContaining("How are people notified?"),
    ]);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("0 of 2 answered")).toBeTruthy();
  });

  it("sends every answer as one message once all are answered", () => {
    show([batch()]);
    fireEvent.click(screen.getByRole("radio", { name: /Finance/ }));
    fireEvent.click(screen.getByRole("radio", { name: /In-app only/ }));
    expect(screen.getByText("2 of 2 answered")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    expect(answer).toHaveBeenCalledWith(expect.stringMatching(/^acme-/), "t1:q:c1", [
      { selected: ["Finance"] },
      { selected: ["In-app only"] },
    ]);
  });

  it("flags what is unanswered instead of sending, and scrolls to it", () => {
    show([batch()]);
    fireEvent.click(screen.getByRole("radio", { name: /Finance/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    expect(answer).not.toHaveBeenCalled();
    const [first, second] = screen.getAllByRole("listitem");
    expect(first!.getAttribute("aria-invalid")).toBeNull();
    expect(second!.getAttribute("aria-invalid")).toBe("true");
    expect(second!.textContent).toContain("Not answered");
    expect(second!.scrollIntoView).toHaveBeenCalled();
  });

  it("can be answered while the batch arrives, and sent once it is complete", () => {
    show([batch({ streaming: true, questions: [WHO] })]);
    const pick = screen.getByRole("radio", { name: /Finance/ }) as HTMLButtonElement;
    expect(pick.disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Still asking/)).toBeTruthy();
  });

  it("keeps a draft when the card is closed and opened again", () => {
    show([batch()]);
    fireEvent.click(screen.getByRole("radio", { name: /Finance/ }));
    cleanup();
    render(
      <OxygenUIThemeProvider theme={OxygenTheme}>
        <QuestionsList projectName={`acme-${n}`} />
      </OxygenUIThemeProvider>,
    );
    expect(screen.getByRole("radio", { name: /Finance/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("says nothing is waiting, or that the answers went, when no question is open", () => {
    show([]);
    expect(screen.getByText(/No questions waiting/)).toBeTruthy();
    cleanup();
    show([batch({ answers: [{ selected: ["Finance"] }, { selected: ["Email"] }] })], "running");
    expect(screen.getByText(/Answers sent\. The agent is working on them\./)).toBeTruthy();
  });

  it("closes once a later message superseded the questions", () => {
    show([batch(), { kind: "user", id: "u2", text: "Actually, wait", state: "sent" }]);
    expect(screen.queryByRole("heading", { name: "Questions for you" })).toBeNull();
    expect(screen.getByText(/No questions waiting/)).toBeTruthy();
  });
});
