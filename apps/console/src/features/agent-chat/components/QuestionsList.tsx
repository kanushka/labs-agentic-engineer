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

import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Box, Button, CircularProgress, Typography } from "@wso2/oxygen-ui";
import { CircleQuestionMark } from "@wso2/oxygen-ui-icons-react";
import type { QuestionAnswer } from "@aep/agent-stream";
import { EmptyState } from "../../../components/EmptyState";
import { answerableQuestionId, openQuestionId, type QuestionItem } from "../chatLog";
import { applyNote, applySelection, isQuestionAnswered, normalizeAnswers } from "../questionCards";
import { questionDraft, saveQuestionDraft } from "../questionDrafts";
import { chatStore, useProjectChat } from "../useProjectChat";
import { QuestionBlock } from "./QuestionBlock";

// The Questions card's body (ADR-0002 / #879): every question the agent is
// waiting on, one list, answered here and sent as one message. The chat only
// points here. The questions are the chat log's (the store this browser
// keeps), so the card and the chat never disagree about what is open.

export function QuestionsList({ projectName }: { projectName: string }) {
  const chat = useProjectChat(projectName);
  const { items, turn } = chat;

  if (chat.status === "loading" && items.length === 0) {
    return (
      <Centered>
        <CircularProgress size={20} aria-label="Loading the questions" />
      </Centered>
    );
  }

  const openId = openQuestionId(items);
  const open = items.find((i): i is QuestionItem => i.kind === "question" && i.id === openId);
  if (open) {
    return (
      <QuestionsForm
        key={open.id}
        projectName={projectName}
        item={open}
        answerable={answerableQuestionId(items) === open.id}
        sending={turn.phase === "starting"}
      />
    );
  }

  return (
    <Centered>
      <EmptyState
        icon={<CircleQuestionMark size={28} />}
        description="No questions waiting. When the agent asks, they show here."
      />
    </Centered>
  );
}

function QuestionsForm({
  projectName,
  item,
  answerable,
  sending,
}: {
  projectName: string;
  item: QuestionItem;
  /** Complete and still waiting: the batch can be sent. */
  answerable: boolean;
  /** An answer is on its way: freeze the form. */
  sending: boolean;
}) {
  const [draft, setDraftState] = useState<QuestionAnswer[]>(() => questionDraft(projectName, item.id));
  // Set once Send was pressed with questions unanswered: they are outlined
  // until answered.
  const [flagged, setFlagged] = useState(false);
  const blocks = useRef<(HTMLLIElement | null)[]>([]);
  const navigate = useNavigate();

  const { questions } = item;
  const answers = normalizeAnswers(questions, draft);
  const answered = questions.map((q, i) => isQuestionAnswered(q, answers[i]));
  const count = answered.filter(Boolean).length;
  const one = questions.length === 1;

  const setDraft = (next: QuestionAnswer[]) => {
    setDraftState(next);
    saveQuestionDraft(projectName, item.id, next);
  };

  const send = () => {
    const gap = answered.indexOf(false);
    if (gap >= 0) {
      setFlagged(true);
      blocks.current[gap]?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Sent: the card has done its job and closes back to the overview. A
    // send that failed keeps it open, answers and all.
    void chatStore.answer(projectName, item.id, answers).then((sent) => {
      if (sent) void navigate({ to: "/projects/$projectName", params: { projectName } });
    });
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 3.5, pt: 3, pb: 3 }}>
        <Box sx={{ maxWidth: "72ch", display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Box>
            <Typography component="h3" sx={{ fontWeight: 600, fontSize: "1rem" }}>
              Questions for you
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {item.streaming
                ? "Still asking… you can start answering."
                : one
                  ? "The agent needs one answer to go on."
                  : `The agent needs ${questions.length} answers to go on.`}
            </Typography>
          </Box>
          <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
            {questions.map((q, i) => {
              const gap = flagged && !answered[i];
              return (
                <Box
                  component="li"
                  key={i}
                  ref={(el: HTMLLIElement | null) => {
                    blocks.current[i] = el;
                  }}
                  aria-invalid={gap || undefined}
                  sx={{
                    display: "flex",
                    gap: 1.25,
                    p: 1.5,
                    border: 1,
                    borderRadius: 2.5,
                    borderColor: gap ? "warning.main" : "divider",
                    bgcolor: "background.paper",
                  }}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    aria-hidden
                    sx={{ fontVariantNumeric: "tabular-nums", minWidth: "2ch", pt: 0.125 }}
                  >
                    {i + 1}.
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <QuestionBlock
                      q={q}
                      answer={answers[i]!}
                      disabled={sending}
                      onSelect={(label) => setDraft(applySelection(questions, answers, i, label))}
                      onNote={(text) => setDraft(applyNote(questions, answers, i, text))}
                    />
                    {gap && (
                      <Typography variant="caption" sx={{ color: "warning.main", display: "block", mt: 0.75 }}>
                        Not answered
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 3.5,
          py: 1.5,
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} aria-live="polite">
          {count} of {questions.length} answered
        </Typography>
        <Button variant="contained" size="small" disabled={!answerable || sending} loading={sending} onClick={send}>
          {one ? "Send answer" : "Send answers"}
        </Button>
      </Box>
    </Box>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ height: "100%", display: "grid", placeItems: "center", px: 3.5 }}>
      <Box sx={{ maxWidth: "48ch" }}>{children}</Box>
    </Box>
  );
}
