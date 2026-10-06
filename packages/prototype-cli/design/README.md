# `@wso2/prototype-cli` — design notes

`prototype init | check | preview | export`. Exit codes: 0 ok, 1 findings or a
failed operation, 2 a usage error (including an unknown theme or an explicit
busy `--port`).

## Preview

A local server bound to 127.0.0.1: the host page, `host.js` (prebuilt by esbuild
at package build time), the theme's `frame-runtime.js`, an SSE stream (`update`
with the last good revision, `findings`) and `POST /feedback`. It answers only
requests addressed to `127.0.0.1:<port>` or `localhost:<port>` and takes
feedback only as JSON from its own origin; a declared or streamed body over
1 MiB gets 413. The host page is sent with `frame-ancestors 'none'` and
`X-Frame-Options: DENY`. If a runtime file is missing the server answers 500
rather than crashing.

The watcher rechecks once the files are quiet for 120 ms and keeps the last good
revision, so a half-written file shows findings over the previous render. It
survives unreadable files: it shows a finding and keeps the last good render.
The kit's check runs off the event loop, so the server answers while a revision
renders; a newer change supersedes a check still in flight.

## Host page

Frames the app in the kit's `PrototypeWindow`; uses the kit's `/host` reducers
for all view state (`reduceReview`: the view plus the open comment bubble) and
its `/feedback` for the request shape, limits, the comment queue
(`FeedbackQueue`: `enqueue`, `editRequest`, `dequeue`, drafts,
`submissionOf`) and the revision hash. `--persist` keeps snapshots in
`localStorage` under `proto:data:<revision hash>`; a new revision starts from
the seed.

Annotate (preview only, never in an export) comments in place, as the
console's review does, in the host's own styles:

- A click on an element opens a comment bubble at it (`AnchoredBubble`,
  placed by the kit's `useFrameAnchors` below the element, or above it when
  there is no room, and kept there as the prototype scrolls or the window
  resizes). Shift-click adds or removes elements, keeping the text. Add or
  Cmd/Ctrl+Enter queues the comment and leaves a numbered pin. The text is
  held to the comment limit, with a counter near it.
- A pin opens its comment, in either mode, to read, Edit (Save or
  Cmd/Ctrl+Enter) or Remove.
- Text is never lost: a bubble closed with text in it (click away, Escape,
  another plain click, leaving the screen) keeps it as a draft where it was
  written, shown as a hollow pin; reopening the same elements, or the draft
  pin, restores it. A whole-screen comment's text is kept the same way and
  comes back on the next Comment on screen. Drafts are not counted or saved.
  An empty bubble just closes.
- The comment bar at the bottom (`CommentBar`) replaces the old side panel:
  the count, which expands into a list of every comment across screens,
  roles and states (an entry goes there and opens the comment), Comment on
  screen, and Save feedback, which writes `.prototype/feedback.json` as
  before (`POST /feedback`; the drafts are never in it). It says when the
  queue is full (50) and when it was started on an earlier revision.
- Keys on the host page: C toggles Annotate (not while typing); Escape closes
  the bubble, then clears the selection (the frame reports an Escape it did
  not use itself). There is no review to close here.

The queue lives in the page's memory: it survives revisions and is saved with
the hash it was started against (`prototypeHash`). There is no agent turn, so
no revision lifecycle.

## Export

One HTML file: the host bundle, the frame runtime and the revision inlined as a
JSON config, escaped against `</script>` breakout (tested). Its CSP allows
inline script with `'unsafe-eval'` because the `srcdoc` frame inherits it;
`connect-src 'none'`. No Annotate, no persistence.

## Tests

Seam 1: the built bin (`test/*.test.ts`, node) and the browser lane
(`vitest.browser.config.ts`, `pnpm --filter @wso2/prototype-cli test:browser`):
tests run in the browser and drive Playwright pages through node-side commands
(`test/browser/commands.ts`: clicks with modifiers, page-level keys, element
boxes in the page's viewport, viewport resizes), so `annotate.browser.test.ts`
asserts the bubble against the real frame's layout. Seam 2: `test/consumer.test.ts` installs the packed
tarballs with npm in a temp directory.
