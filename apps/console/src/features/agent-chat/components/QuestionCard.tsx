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

import { useState } from "react";
import { Box, Button, Typography } from "@wso2/oxygen-ui";
import type { AskQuestionInput, QuestionAnswer } from "@aep/agent-stream";
import type { QuestionItem } from "../chatLog";
import { applyNote, applySelection, isQuestionAnswered, normalizeAnswers } from "../questionCards";
import { QuestionBlock } from "./QuestionBlock";
import { QuestionPager } from "./QuestionPager";

// The agent's question, as a card in the chat. One question is one plain card;
// a batch is one card that asks a question at a time (QuestionPager, ADR-0002).

/**
 * One card. Answerable while it is the question the conversation waits on;
 * once answered (here, or by a later message) it folds to its questions, and
 * the answer reads as the user's message below it.
 */
export function QuestionCard({
  item,
  answerable,
  sending,
  onAnswer,
}: {
  item: QuestionItem;
  answerable: boolean;
  /** An answer is on its way: freeze the card. */
  sending: boolean;
  onAnswer: (answers: QuestionAnswer[]) => void;
}) {
  if (!answerable || item.answers) {
    return (
      <Box sx={{ borderLeft: 2, borderColor: "divider", pl: 1.25, display: "flex", flexDirection: "column", gap: 0.25 }}>
        {item.questions.map((q, i) => (
          <Typography key={i} variant="caption" color="text.secondary" component="p">
            {q.question}
          </Typography>
        ))}
      </Box>
    );
  }
  // Only a batch streams, so a streaming card is a batch even while one
  // question has arrived.
  if (item.streaming || item.questions.length > 1) {
    return <QuestionPager questions={item.questions} streaming={item.streaming} sending={sending} onAnswer={onAnswer} />;
  }
  return <SingleQuestion q={item.questions[0]!} sending={sending} onAnswer={onAnswer} />;
}

function SingleQuestion({
  q,
  sending,
  onAnswer,
}: {
  q: AskQuestionInput;
  sending: boolean;
  onAnswer: (answers: QuestionAnswer[]) => void;
}) {
  const [draft, setDraft] = useState<QuestionAnswer[]>([]);
  const questions = [q];
  const answers = normalizeAnswers(questions, draft);
  return (
    <Box
      component="section"
      aria-label="The agent's question"
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2.5,
        bgcolor: "background.paper",
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.75,
      }}
    >
      <QuestionBlock
        q={q}
        answer={answers[0]!}
        disabled={sending}
        onSelect={(label) => setDraft(applySelection(questions, answers, 0, label))}
        onNote={(text) => setDraft(applyNote(questions, answers, 0, text))}
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          size="small"
          variant="contained"
          disabled={!isQuestionAnswered(q, answers[0]) || sending}
          loading={sending}
          onClick={() => onAnswer(answers)}
        >
          Send answer
        </Button>
      </Box>
    </Box>
  );
}
