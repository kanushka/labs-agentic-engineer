# ADR-0002 — A batch of questions is asked one at a time, and sent from its Answers page

**Status:** Accepted · 2026-10-05
**Supersedes:** point 4's "several as a form" in
console [ADR-0012](https://github.com/wso2/labs-agentic-engineer/blob/classic-console/apps/console/design/decisions/ADR-0012-agent-hitl-tool-call-question-cards.md)
(at the `classic-console` tag)
(the rest of ADR-0012 stands). Spec: #879.

## Context

The agent asks through `ask_question` (one) and `ask_questions` (a batch of up
to 8, each with up to 5 described options and a free answer). ADR-0012 renders
a batch as one form: every question stacked in one card, one Send at the
bottom. In a spec interview that is a wall of options in a single chat
message; the user loses track of what is answered and finds Send only after
scrolling past all of it.

## Decision

1. **A batch is one card that shows one question at a time.** A strip of
   numbered tabs (a ✓ once answered) and a final **Answers** tab sit at the
   top; any tab is reachable at any time. A single `ask_question` stays one
   plain card, with no tabs and no Answers page.
2. **Send lives on the Answers page, and only there.** It lists every
   question with its answer and marks what is unanswered; Send stays disabled
   until every question is answered (ADR-0012's gate, unchanged). The batch still returns
   as ONE `Answers:` instruction, so the wire, the agent and the answer
   serializers in `@aep/agent-stream` do not change.
3. **Choosing moves the user on.** Picking an option on a single-choice
   question advances to the next unanswered question, or to the Answers page
   once all are answered. Multi-choice and typed answers advance on Next.
4. **Nothing is pre-selected.** The agent's `recommended` option is a label,
   never a default.

## Rejected

- **The stacked form** (ADR-0012's "several as a form"): the problem above.
- **Sending each answer as it is given:** one agent turn per answer, and the
  agent replies between questions that were meant to be decided together.
- **Pre-selecting the recommended option:** accepting a batch becomes Enter,
  Enter, Send, and the agent's guesses read back as the user's decisions.
- **Sending a partial batch with skipped questions:** it changes what the
  agent receives; a free answer ("no preference") already covers it.

## Consequences

- Answering is a client-side walk over the same draft answers ADR-0012
  defined; the page and the draft live in the card and are lost on reload, as
  the draft already was.
- A composer message still supersedes the open card (#433), which now hides
  the pages the user had not reached, not just a visible form.
- The last page is **Answers**, not "Review": the lexicon gives Review to the
  prototype (open it full screen), and one word must not name two things.
