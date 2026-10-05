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

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Box, Button, ButtonBase, Tab, Tabs, Typography } from "@wso2/oxygen-ui";
import { StepMarker } from "../../../components/StepMarker";
import type { AskQuestionInput, QuestionAnswer } from "@aep/agent-stream";
import { applyNote, applySelection, isFreeTextOption, isQuestionAnswered, normalizeAnswers } from "../questionCards";
import { advancesOnPick, answerSummary, nextPage, pageAfterPick, previousPage, type PagerPage } from "../questionPager";
import { QuestionBlock } from "./QuestionBlock";

// A batch of the agent's questions as one card, one question at a time
// (ADR-0002 / #879): numbered tabs, a ✓ once answered, and an Answers page
// that lists them and sends the batch as one answer. A pick on a single-choice
// question moves on by itself; keys 1–9 pick, ←/→ move, Enter moves on or sends.
// The card is as tall as its tallest page throughout, so moving never resizes it.

/** The page on show, of the stacked ones. */
function shownPage(pages: HTMLElement | null): HTMLElement | null {
  return pages?.querySelector<HTMLElement>("[role='tabpanel']") ?? null;
}

/**
 * One page of the card. The ones not on show still take up their room (it is
 * what sets the card's height) but are hidden from sight, the keyboard and
 * assistive tech alike.
 */
function Page({
  shown,
  id,
  labelledBy,
  children,
}: {
  shown: boolean;
  id: string;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <Box
      role={shown ? "tabpanel" : undefined}
      id={shown ? id : undefined}
      aria-labelledby={shown ? labelledBy : undefined}
      aria-hidden={shown ? undefined : true}
      inert={!shown}
      tabIndex={shown ? -1 : undefined}
      sx={{ gridArea: "1 / 1", visibility: shown ? "visible" : "hidden", outline: "none" }}
    >
      {children}
    </Box>
  );
}

/** Where a key press belongs to the control under it, not to the card. */
function ownsKeys(target: HTMLElement): boolean {
  return target.closest("textarea, input, [role='tab']") !== null;
}

export function QuestionPager({
  questions,
  streaming,
  sending,
  onAnswer,
}: {
  questions: AskQuestionInput[];
  /** The batch is still arriving: its questions can be read, not yet answered. */
  streaming: boolean;
  /** An answer is on its way: freeze the card. */
  sending: boolean;
  onAnswer: (answers: QuestionAnswer[]) => void;
}) {
  const ids = useId();
  const [draft, setDraft] = useState<QuestionAnswer[]>([]);
  const [page, setPage] = useState<PagerPage>(0);
  const pages = useRef<HTMLDivElement | null>(null);
  // Set when a move takes away the control that had focus (the option just
  // picked, a row on the Answers page): the new page takes it, so the keys
  // keep reaching the card.
  const refocus = useRef(false);

  const answers = normalizeAnswers(questions, draft);
  const answered = questions.map((q, i) => isQuestionAnswered(q, answers[i]));
  const complete = answered.every(Boolean);
  const frozen = streaming || sending;
  const count = questions.length;

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    shownPage(pages.current)?.focus({ preventScroll: true });
  }, [page]);

  const go = (to: PagerPage, takeFocus = false) => {
    refocus.current = takeFocus;
    setPage(to);
  };

  const pick = (qi: number, label: string) => {
    const next = applySelection(questions, answers, qi, label);
    setDraft(next);
    if (advancesOnPick(questions[qi]!, next[qi]!, label)) go(pageAfterPick(questions, next, qi), true);
  };

  const send = () => {
    if (complete && !frozen) onAnswer(answers);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (ownsKeys(target) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(nextPage(count, page), true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(previousPage(count, page), true);
    } else if (e.key === "Enter" && target.closest("button, [role='radio'], [role='checkbox']") === null) {
      e.preventDefault();
      if (page === "answers") send();
      else go(nextPage(count, page), true);
    } else if (/^[1-9]$/.test(e.key) && page !== "answers" && !frozen) {
      const q = questions[page]!;
      const opt = q.options[Number(e.key) - 1];
      if (!opt) return;
      e.preventDefault();
      const turningOn = !answers[page]!.selected.includes(opt.label);
      pick(page, opt.label);
      if (turningOn && isFreeTextOption(opt)) shownPage(pages.current)?.querySelector("textarea")?.focus();
    }
  };

  const tabId = (p: PagerPage) => `${ids}-tab-${p}`;

  return (
    <Box
      component="section"
      aria-label="The agent's questions"
      onKeyDown={onKeyDown}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2.5,
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 0.75, borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={page}
          onChange={(_, to: PagerPage) => go(to)}
          variant="scrollable"
          scrollButtons={false}
          aria-label="Questions"
          sx={{
            minHeight: 36,
            flex: 1,
            "& .MuiTab-root": { minHeight: 36, minWidth: 0, px: 1.25, py: 0 },
          }}
        >
          {questions.map((_, i) => (
            <Tab
              key={i}
              value={i}
              id={tabId(i)}
              aria-controls={`${ids}-panel`}
              aria-label={`Question ${i + 1}${answered[i] ? ", answered" : ""}`}
              // The overview track's step marker: muted, primary on the
              // question in view, a check in place of the number once answered.
              label={<StepMarker step={i + 1} tone={page === i ? "primary" : null} ticked={answered[i] === true} />}
            />
          ))}
          <Tab
            value="answers"
            id={tabId("answers")}
            aria-controls={`${ids}-panel`}
            aria-label={complete ? "Answers, all answered" : "Answers"}
            label="Answers"
          />
        </Tabs>
        {streaming && (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, pr: 0.75 }}>
            Still asking…
          </Typography>
        )}
      </Box>

      <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {/* Every page sits in the one grid cell and only the current one
            shows, so the card keeps its tallest page's height and does not
            jump as the user moves through the batch (#879). */}
        <Box ref={pages} sx={{ display: "grid" }}>
          {questions.map((q, i) => (
            <Page key={i} shown={page === i} id={`${ids}-panel`} labelledBy={tabId(i)}>
              <QuestionBlock
                q={q}
                answer={answers[i]!}
                disabled={frozen}
                keyHints
                onSelect={(label) => pick(i, label)}
                onNote={(text) => setDraft(applyNote(questions, answers, i, text))}
              />
            </Page>
          ))}
          <Page shown={page === "answers"} id={`${ids}-panel`} labelledBy={tabId("answers")}>
            <AnswersPage questions={questions} answers={answers} onOpen={(i) => go(i, true)} />
          </Page>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
          <Button size="small" variant="text" disabled={page === 0} onClick={() => go(previousPage(count, page))}>
            Back
          </Button>
          {page === "answers" ? (
            <Button size="small" variant="contained" disabled={!complete || frozen} loading={sending} onClick={send}>
              Send answers
            </Button>
          ) : (
            <Button size="small" variant="outlined" onClick={() => go(nextPage(count, page))}>
              Next
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** Every question with the answer it has so far; a row opens its question. */
function AnswersPage({
  questions,
  answers,
  onOpen,
}: {
  questions: AskQuestionInput[];
  answers: QuestionAnswer[];
  onOpen: (index: number) => void;
}) {
  return (
    <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 0.5 }}>
      {questions.map((q, i) => {
        const summary = answerSummary(q, answers[i]);
        return (
          <Box component="li" key={i}>
            <ButtonBase
              onClick={() => onOpen(i)}
              sx={{
                width: "100%",
                display: "flex",
                alignItems: "flex-start",
                gap: 1,
                textAlign: "start",
                px: 1,
                py: 0.75,
                borderRadius: 1.5,
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", pt: 0.125 }}>
                {i + 1}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.25 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                >
                  {q.question}
                </Typography>
                <Typography
                  variant="body2"
                  sx={summary ? { fontWeight: 600, overflowWrap: "anywhere" } : { color: "warning.main" }}
                >
                  {summary ?? "Not answered"}
                </Typography>
              </Box>
            </ButtonBase>
          </Box>
        );
      })}
    </Box>
  );
}
