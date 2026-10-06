# Prototype review

A clickable prototype of each designed web application, tried and annotated in
the browser. The agent makes it (`/prototype`), the person reviews it, and
Annotate feedback goes back to the chat as a typed batch. Why it is shaped this
way: [ADR-0001](decisions/ADR-0001-prototype-review-is-a-full-screen-overlay.md)
(the overlay), [ADR-0002](decisions/ADR-0002-the-revision-lands-in-the-open-review.md)
(the revision lands in the open review),
[ADR-0003](decisions/ADR-0003-the-comment-bubble-is-drawn-by-the-host.md)
(the bubble is the host's, over the frame).
Code: `features/prototype/`.

## Where it shows

- **Prototype tab** (`PrototypeWorkspace`, route `projects/$p/prototype`): one
  centered entry per web application (a contract artifact whose `design.json`
  type is `web-application`) with status None, Ready, Invalid (the reason in a
  tooltip) or Revising, and one action: Review once a prototype renders, else
  Make prototype (Try again when invalid). No action while the first one is
  being made. Revising an existing prototype goes through Annotate in review;
  remaking it from a changed design is the Design tab's Make prototype. The tab
  shows a dot while a prototype is unreviewed.
- **Design actions:** Make prototype (`MakePrototypeButton`), hidden until the
  design has a web application. One app sends `/prototype <c>`, several send a
  bare `/prototype`. Disabled unless the chat can send.
- **Chat:** an "Open prototype" note after a `/prototype` exchange that wrote
  a prototype which is valid now (one component opens its review, several
  open the tab). It is derived (`model/note.ts`) from the log, which the
  history carries, and the room, so a reload and teammates see it too.

## Files

A prototype is `specs/design/components/<c>/prototype.{json,tsx}` in the room,
read with `useRoomFiles`. Status comes from the kit's `parseManifestJson`
(`model/prototypes.ts`). The agent's writes are gated by the kit's rules and the
render check; Go re-checks on save (see ADR-0042).

## Review

`PrototypeReview`: toolbar (Screen, Flow, Role, State, Reset data,
Preview/Annotate), the kit `PrototypeWindow` (browser chrome, read-only `prototype://<screen>` address bar; styled by the console with `--proto-window-*` Oxygen variables) around the `PrototypeFrame` at full width, and the floating
`SendBar` below it. The view and the open comment bubble are one pure state
(`model/review.ts`: the kit's view reducer plus `CommentBubble` = on the
selection, on the whole screen, or a queued comment opened from the bar's
list). `C` toggles Annotate; Escape closes the bubble, then clears the
selection, then closes (`useReviewKeys`). With focus in the prototype, only
the frame's `proto:escape` counts (sent when the prototype left the key
unused); the review ignores an Escape whose target is the frame.

- **Bubble** (`CommentBubble`, `QueuedCommentBubble` in `AnchoredBubble`): an
  Annotate click opens it at the element (Shift-click adds elements), drawn by
  the console over the frame from the boxes the frame reports
  (`useFrameAnchors`), never inside it (ADR-0003). Add or Cmd/Ctrl+Enter
  queues the comment.
- **Send bar** (`SendBar`): `N comments`, `Comment on screen` (a whole-screen
  comment; its bubble anchors to the bar; clicking empty canvas opens
  nothing), `Send to agent`, the queue-full note, and an expandable list of
  every queued comment across screens, roles and states. An entry goes to its
  screen, role and state and opens the comment. While a revision runs it says
  `Agent is revising… (N comments)` and Send waits; it flags comments whose
  element is gone and says why a revision failed, with Retry.

- **Preview** acts: navigation, forms, mock data. **Annotate** only selects;
  selected elements are pinned and a request is typed against them (max 4000
  characters, 50 requests per batch, the kit CLI's limits).
- **Pins:** a queued comment's pin (the frame's, in both modes, keyboard
  reachable) opens its bubble (`OPEN_PIN`) with Edit (in place) and Remove
  (the rest renumber). Closing a bubble with Escape, Add or Remove puts focus
  back on its element or pin (`PrototypeFrame.focusElement`).
- **Drafts** (`useCommentDraft`, over the kit's `followSelection`): the text
  of a bubble on elements is never lost. Escape, a click away, a plain click
  on other elements or closing the review keeps it as a draft, shown as a
  hollow pin; selecting the same elements or clicking the draft pin
  (`SELECT_ELEMENTS`, from Preview too) reopens it. Drafts are not counted or
  sent, and survive Send. A whole-screen comment's text is kept the same way,
  as the screen's draft (no pin), which Comment on screen reopens with.
- **Queue** (the kit's `FeedbackQueue`; `model/feedback.ts` makes the batch): per component, with its drafts, kept across close and reopen.
  It carries the hash of the revision of its first request. Requests,
  limits, pins and the hash are the kit's (`@wso2/prototype-kit/feedback`);
  the hash is plain JavaScript, so it works over plain HTTP.
- **Send to agent:** refused with the reason while the chat is not idle (queue
  kept). Otherwise `chatStore.send("/prototype <c>", {kind: "prototype",
  feedback})`; on success the chat opens behind the review, the queue clears
  (drafts kept), the review stays open and the design data is read again. The batch is journaled with the turn and comes back in
  the history (`ConversationMessage.prototypeFeedback`); the chat row shows
  `feedbackSummary` of it (`model/summary.ts`: screen, role and state named
  from the manifest, element ids, text), not the wire text.
- **Revision** (ADR-0002; `model/revision.ts`, kept per component by
  `usePrototypeReviews` in `PrototypeWorkspace` so it outlives the overlay):
  the sent batch is held until its turn ends. While the prototype is revising
  the review shows the last ready revision, not the files the agent is still
  writing. Revising → ready swaps the new revision in through
  `MANIFEST_REPLACED` (same screen, role and state, else the role's entry
  screen), the frame reloads from the seed data, and an `Updated · N comments
  addressed` toast offers What changed (closes the review, opens the chat).
  Comments carried over from the earlier revision are checked against the
  elements the frame says its screen draws (the kit's `orphansOnScreen`, same
  screen, role and state only) and flagged "Element no longer on this
  screen", with Keep as screen comment (`keepOnScreen`) or Remove. A failed
  turn (`chatStore.onTurnEnd`) or an invalid revision keeps the last ready
  revision showing and puts the batch back in front of the queue
  (`restored`), with the reason and Retry. A stream lost mid-turn reports no
  outcome; the status (ready or invalid) decides. Reopened mid-revision, the
  review shows the same state.
- **Reviewed dot:** shown while a valid prototype's current revision is
  unreviewed in this browser (not while a turn is revising it).
  `model/reviewed.ts` stores `{component: hash}` in localStorage
  (`aep:prototype-reviewed:<project>`); every access is guarded.

## Wire

`turnBody` puts `prototypeFeedback` (`PrototypeFeedbackInput`, from the
generated API types) on the JSON body with `collab: true`; the instruction is
the bare `/prototype` or `/prototype <c>` with the same component. The mock
(`mocks/fixtures/prototype.ts`) writes the manifest then the source, answers
feedback by number, and refuses a bad batch as Go does. Its revisions: "on
the right" and "bigger total" apply, "remove" takes the Reject button away
(orphaning comments on it), and "fail" fails the turn (`turn-failed`, status
failed) writing nothing.

## Theme

`@wso2/prototype-theme-oxygen`, drawn with the console's own theme
(`@aep/ui-theme`, the `aepTheme` `main.tsx` applies), so the prototype and the
console cannot drift. Until the frame's app first draws, the review passes
`PrototypeFrame` a loading state ("Starting the prototype…") that covers the
frame, so a click while the runtime starts is not lost; a frame that never
draws shows the kit's "didn't start" error instead. The review passes the
console's resolved scheme (`useColorScheme`: the mode, or the system's under
System), so the prototype is light or dark with the console. Its frame has no
storage (opaque origin), so a script that touches `localStorage` in every
frame (for example a Playwright init script) raises there; limit it to the top
frame.
