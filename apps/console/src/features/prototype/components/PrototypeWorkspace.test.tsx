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

import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OxygenTheme, OxygenUIThemeProvider, useColorScheme } from "@wso2/oxygen-ui";
import { PROTOTYPE_START_TIMEOUT_MS } from "@wso2/prototype-kit/host";
import type { ProjectChat } from "../../agent-chat/chatStore";
import { SAMPLE_MANIFEST, SAMPLE_SOURCE } from "../../../mocks/fixtures/prototype";
import { appPrototypes, manifestPath, revisingIn, sourcePath, type AppPrototype } from "../model/prototypes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MAX_FEEDBACK_REQUESTS, MAX_FEEDBACK_TEXT, prototypeHash } from "@wso2/prototype-kit/feedback";
import { designKey } from "../../design/api/designModel";
import { unreviewed } from "../model/reviewed";

// The Prototype tab and its full-screen review, driven as a reviewer drives
// them: the prototype runs in the kit's PrototypeFrame, whose messages are
// played here as the sandboxed frame would send them, and the turns go to the
// project's chat, which is stubbed at its store.

const C = "expense-web";
const files = { [manifestPath(C)]: SAMPLE_MANIFEST, [sourcePath(C)]: SAMPLE_SOURCE };

let prototypes: AppPrototype[] | undefined;
vi.mock("../usePrototypes", () => ({ usePrototypes: () => prototypes }));

let chat: ProjectChat;
const send = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("../../agent-chat/useProjectChat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agent-chat/useProjectChat")>()),
  useProjectChat: () => chat,
  chatStore: { send: (...args: unknown[]) => send(...args) },
}));

const openChat = vi.fn();
vi.mock("../../shell/chatPanel", () => ({ useChatPanel: () => ({ open: openChat }) }));

// The theme's 2 MB runtime is the kit's browser lane's to run; the frame here only needs one.
vi.mock("../useReviewAssets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../useReviewAssets")>()),
  useFrameRuntime: () => ({ value: "/* frame runtime */", error: null }),
}));

// jsdom lays nothing out and has no ResizeObserver; the review's anchors only need it to exist.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

const { PrototypeWorkspace } = await import("./PrototypeWorkspace");

const idle: ProjectChat = { status: "ready", error: null, items: [], turn: { phase: "idle" } };
const busy: ProjectChat = { ...idle, turn: { phase: "running", turnId: "t1", instruction: "/design F1" } };

let queryClient = new QueryClient();
let invalidate = vi.spyOn(queryClient, "invalidateQueries");

/** The console switched to its dark scheme, as its user menu does. */
function DarkMode() {
  const { setMode } = useColorScheme();
  useEffect(() => setMode("dark"), [setMode]);
  return null;
}

function Harness({ initial, dark = false }: { initial?: string; dark?: boolean }) {
  const [review, setReview] = useState<string | undefined>(initial);
  return (
    <QueryClientProvider client={queryClient}>
      <OxygenUIThemeProvider theme={OxygenTheme}>
        {dark && <DarkMode />}
        <PrototypeWorkspace projectName="acme-expenses" review={review} onReview={(c) => setReview(c ?? undefined)} />
      </OxygenUIThemeProvider>
    </QueryClientProvider>
  );
}

function frame(): HTMLIFrameElement {
  return screen.getByTitle("Acme Expenses prototype app") as HTMLIFrameElement;
}

/** A message from the sandboxed frame, as its runtime posts it. */
function fromFrame(data: object) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: frame().contentWindow }));
  });
}

/** What the host last told the frame to draw. */
function lastView(post: { mock: { calls: unknown[][] } }) {
  const messages = post.mock.calls.map((c) => c[0] as { type: string; view?: { mode: string; screenId: string; selectedKeys: string[]; pins: object } });
  return messages.filter((m) => m.view).at(-1)!.view!;
}

async function openReview() {
  render(<Harness initial={C} />);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(frame()).toBeInTheDocument());
  const post = vi.spyOn(frame().contentWindow!, "postMessage");
  fromFrame({ type: "proto:ready" });
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "proto:load" }), "*"));
  return { dialog, post };
}

function annotate(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Annotate" }));
}

/** Where an element is drawn in the frame's viewport, as the frame reports it (jsdom lays nothing out). */
const BOX = { x: 40, y: 120, width: 160, height: 36 };

/** A click on an element in the prototype, as the frame reports it: where it is, and whether it held Shift. */
function clickElement(elementKey: string, { shift = false, box = BOX } = {}) {
  fromFrame({ type: "proto:toggle", elementKey, box, additive: shift });
}

/** The comment bubble open by the prototype. */
function bubble() {
  return screen.getByRole("dialog", { name: /^Comment on/ });
}

/** The floating send bar at the bottom of the review. */
function bar() {
  return screen.getByRole("region", { name: "Comments" });
}

/** The bar's list of every queued comment, expanded. */
function commentList() {
  const toggle = within(bar()).getByRole("button", { name: /^\d+ comments?$/ });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return within(bar()).getByRole("list", { name: "Queued comments" });
}

function addComment(text: string) {
  fireEvent.change(within(bubble()).getByLabelText("Comment"), { target: { value: text } });
  fireEvent.click(within(bubble()).getByRole("button", { name: "Add" }));
}

beforeEach(() => {
  queryClient = new QueryClient();
  invalidate = vi.spyOn(queryClient, "invalidateQueries");
  prototypes = appPrototypes([C], files, null);
  chat = idle;
  send.mockClear();
  send.mockResolvedValue(true);
  openChat.mockClear();
});

afterEach(cleanup);

describe("the Prototype tab", () => {
  it("lists each web application with its prototype's status", () => {
    prototypes = [
      ...appPrototypes(["admin-web"], { [manifestPath("admin-web")]: "{" , [sourcePath("admin-web")]: "x" }, null),
      ...appPrototypes([C], files, revisingIn("/prototype expense-web")),
      ...appPrototypes(["kiosk-web"], {}, null),
    ];
    render(<Harness />);
    const rows = within(screen.getByRole("list", { name: "Prototypes" })).getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByText(/^(Invalid|Revising…|No prototype|Ready)$/).textContent)).toEqual(["Invalid", "Revising…", "No prototype"]);
    expect(within(rows[0]!).getByLabelText(/prototype\.json is invalid/)).toHaveTextContent("The last prototype couldn't be rendered.");
    expect(within(rows[0]!).queryByRole("button", { name: "Review" })).toBeNull();
    expect(within(rows[0]!).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("button", { name: "Review" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(within(rows[2]!).getByRole("button", { name: "Make prototype" })).toBeInTheDocument();
  });

  it("says the prototype is being made while its first turn runs", () => {
    prototypes = appPrototypes([C], {}, revisingIn("/prototype expense-web"));
    render(<Harness />);
    expect(screen.getByText("Making prototype…")).toBeInTheDocument();
    expect(screen.getByLabelText("Working on the prototype")).toBeInTheDocument();
  });

  it("shows a prototype the running turn is still writing as in progress, not broken", () => {
    prototypes = [
      ...appPrototypes([C], { [manifestPath(C)]: SAMPLE_MANIFEST }, revisingIn("/prototype")),
      ...appPrototypes(["admin-web"], {}, revisingIn("/prototype")),
    ];
    chat = { ...idle, turn: { phase: "running", turnId: "t1", instruction: "/prototype" } };
    render(<Harness />);
    const rows = within(screen.getByRole("list", { name: "Prototypes" })).getAllByRole("listitem");
    expect(within(rows[0]!).queryByText("The last prototype couldn't be rendered.")).toBeNull();
    expect(within(rows[0]!).getByText("The agent is working on it.")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Making prototype…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why Make prototype waits while another turn runs", () => {
    prototypes = appPrototypes([C], {}, null);
    chat = busy;
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Make prototype" })).toBeDisabled();
    expect(screen.getByText(/The agent is busy with a turn/)).toBeInTheDocument();
  });

  it("says there is no prototype yet and the spec and design come first", () => {
    prototypes = [];
    render(<Harness />);
    expect(screen.getByText(/Finish the spec and design a web application first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make prototype/ })).toBeNull();
  });

  it("offers Make prototype in the empty state once the design has a web application", () => {
    prototypes = appPrototypes([C], {}, null);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Make prototype" }));
    expect(openChat).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("acme-expenses", "/prototype expense-web", { kind: "prototype" });
  });
});

describe("the full-screen review", () => {
  it("opens from Review over the whole console, and closes with Close and with Escape", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Prototype · Acme Expenses")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("leaves Escape pressed in the prototype to the frame: closes only on the frame's proto:escape", async () => {
    const { dialog, post } = await openReview();
    // A key the console's document gets with the frame element as its target was aimed at the prototype (focus is
    // in it), so it is the prototype's, not the dialog's: only the frame says when Escape went unused.
    fireEvent.keyDown(frame(), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Annotate: the frame's Escape closes the comment bubble first, then clears the selection, then closes the review.
    annotate(dialog);
    clickElement("btn.new-claim");
    fromFrame({ type: "proto:escape" });
    expect(screen.getByRole("dialog", { name: "Prototype · Acme Expenses" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();
    expect(lastView(post).selectedKeys).toEqual(["btn.new-claim"]);
    fromFrame({ type: "proto:escape" });
    expect(lastView(post).selectedKeys).toEqual([]);
    expect(screen.getByRole("dialog", { name: "Prototype · Acme Expenses" })).toBeInTheDocument();
    fromFrame({ type: "proto:escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("covers the frame with a loading state until the prototype first draws, so an early click is not lost", async () => {
    render(<Harness initial={C} />);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(frame()).toBeInTheDocument());
    // The runtime has not started yet, then it has but the app has not drawn.
    expect(within(dialog).getByRole("status")).toHaveTextContent("Starting the prototype…");
    expect(frame()).toHaveAttribute("aria-busy", "true");
    fromFrame({ type: "proto:ready" });
    expect(within(dialog).getByRole("status")).toHaveTextContent("Starting the prototype…");
    fromFrame({ type: "proto:rendered", screenId: "screen.my-claims", elements: [] });
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(frame()).toHaveAttribute("aria-busy", "false");

    // A frame document that reloads starts again; one that fails to load stops covering and shows why.
    fromFrame({ type: "proto:ready" });
    expect(within(dialog).getByRole("status")).toBeInTheDocument();
    fromFrame({ type: "proto:error", message: "prototype.tsx failed" });
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("prototype.tsx failed");
  });

  it("stops waiting on a frame that neither draws nor says why, and says it did not start", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Harness initial={C} />);
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(frame()).toBeInTheDocument());
      fromFrame({ type: "proto:ready" });
      expect(within(dialog).getByRole("status")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(PROTOTYPE_START_TIMEOUT_MS);
      });
      expect(within(dialog).queryByRole("status")).toBeNull();
      expect(within(dialog).getByRole("alert")).toHaveTextContent("The prototype didn't start");
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws the prototype in the console's scheme", async () => {
    try {
      render(<Harness initial={C} dark />);
      await screen.findByRole("dialog");
      await waitFor(() => expect(frame()).toBeInTheDocument());
      const post = vi.spyOn(frame().contentWindow!, "postMessage");
      fromFrame({ type: "proto:ready" });
      await waitFor(() =>
        expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "proto:load", view: expect.objectContaining({ colorScheme: "dark" }) }), "*"),
      );
    } finally {
      localStorage.clear();
    }
  });

  it("says why instead of drawing a blank frame when the prototype is invalid", async () => {
    prototypes = appPrototypes([C], { [manifestPath(C)]: SAMPLE_MANIFEST }, null);
    render(<Harness initial={C} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/prototype\.tsx is missing/)).toBeInTheDocument();
    expect(screen.queryByTitle("Acme Expenses prototype app")).toBeNull();
  });

  it("acts in Preview and only selects in Annotate", async () => {
    const { dialog, post } = await openReview();
    const screenPicker = within(dialog).getByLabelText("Screen") as HTMLSelectElement;

    // Preview: a press in the app navigates; a stray toggle selects nothing.
    fromFrame({ type: "proto:navigate", screenId: "screen.new-claim" });
    expect(screenPicker.value).toBe("screen.new-claim");
    fromFrame({ type: "proto:toggle", elementKey: "btn.submit" });
    expect(lastView(post)).toMatchObject({ mode: "preview", screenId: "screen.new-claim", selectedKeys: [] });

    // Annotate: a click selects (and the comment bubble says what), and a navigation is ignored.
    annotate(dialog);
    fromFrame({ type: "proto:rendered", screenId: "screen.new-claim", elements: [{ key: "btn.submit", label: "Submit claim" }] });
    clickElement("btn.submit");
    fromFrame({ type: "proto:navigate", screenId: "screen.my-claims" });
    expect(screenPicker.value).toBe("screen.new-claim");
    expect(lastView(post)).toMatchObject({ mode: "annotate", screenId: "screen.new-claim", selectedKeys: ["btn.submit"] });
    expect(bubble()).toHaveAccessibleName("Comment on Submit claim");
  });

  it("frames the prototype in a browser window whose address follows the screen", async () => {
    const { dialog } = await openReview();
    const window = within(dialog).getByRole("region", { name: "Acme Expenses prototype" });
    expect(within(window).getByLabelText("Address")).toHaveTextContent("prototype://screen.my-claims");
    expect(within(window).getByTitle("Acme Expenses prototype app")).toBeInTheDocument();

    fromFrame({ type: "proto:navigate", screenId: "screen.new-claim" });
    expect(within(window).getByLabelText("Address")).toHaveTextContent("prototype://screen.new-claim");
  });

  it("queues comments with numbered pins, and removes one", async () => {
    const { dialog, post } = await openReview();
    annotate(dialog);
    clickElement("btn.new-claim");
    addComment("Call it Submit a claim");
    clickElement("btn.new-claim");
    addComment("Too much white space");
    expect(lastView(post)).toMatchObject({ selectedKeys: [], pins: { "btn.new-claim": [1, 2] } });
    expect(bar()).toHaveTextContent("2 comments");
    const queue = commentList();
    expect(within(queue).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(within(queue).getByRole("button", { name: "Remove comment 1" }));
    expect(within(queue).getAllByRole("listitem")).toHaveLength(1);
    expect(bar()).toHaveTextContent("1 comment");
    expect(within(bar()).getByRole("button", { name: "Send to agent" })).toBeEnabled();
  });

  it("sends every request as one typed /prototype turn, closes, and opens the chat", async () => {
    const { dialog } = await openReview();
    fireEvent.change(within(dialog).getByLabelText("Flow"), { target: { value: "flow.approve" } });
    annotate(dialog);
    fromFrame({
      type: "proto:rendered",
      screenId: "screen.pending",
      elements: [{ key: "btn.reject", label: "Reject" }, { key: "btn.approve", label: "Approve" }],
    });
    clickElement("btn.reject");
    clickElement("btn.approve", { shift: true });
    addComment("Put Approve on the right");
    fireEvent.change(within(dialog).getByLabelText("State"), { target: { value: "state.empty" } });
    clickElement("empty.pending");
    addComment("Say who to ask when nothing waits");
    expect(bar()).toHaveTextContent("2 comments");
    fireEvent.click(within(bar()).getByRole("button", { name: "Send to agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(openChat).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("acme-expenses", "/prototype expense-web", {
      kind: "prototype",
      feedback: {
        prototypeHash: prototypeHash(SAMPLE_MANIFEST, SAMPLE_SOURCE),
        component: C,
        requests: [
          { screenId: "screen.pending", flowId: "flow.approve", roleId: "manager", stateId: "state.default", elementIds: ["btn.reject", "btn.approve"], text: "Put Approve on the right" },
          { screenId: "screen.pending", flowId: "flow.approve", roleId: "manager", stateId: "state.empty", elementIds: ["empty.pending"], text: "Say who to ask when nothing waits" },
        ],
      },
    });
    // The cards see the turn running as soon as the server has it.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: designKey("acme-expenses") });

    // Sent: opening it again starts a new queue.
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByRole("dialog");
    expect(bar()).toHaveTextContent("0 comments");
  });

  it("records the revision it showed as reviewed in this browser", async () => {
    await openReview();
    const hash = prototypeHash(SAMPLE_MANIFEST, SAMPLE_SOURCE);
    await waitFor(() => expect(unreviewed("acme-expenses", { [C]: hash })).toEqual([]));
  });

  it("refuses Send while a turn is running, says why, and keeps the queue", async () => {
    chat = busy;
    const { dialog } = await openReview();
    annotate(dialog);
    clickElement("btn.new-claim");
    addComment("Too much white space");
    fireEvent.click(within(bar()).getByRole("button", { name: "Send to agent" }));
    expect(within(bar()).getByRole("alert")).toHaveTextContent(/working on another turn.*kept/);
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(commentList()).getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the queue when the chat does not take the turn, and across closing and opening again", async () => {
    send.mockResolvedValue(false);
    const { dialog } = await openReview();
    annotate(dialog);
    clickElement("btn.new-claim");
    addComment("Too much white space");
    fireEvent.click(within(bar()).getByRole("button", { name: "Send to agent" }));
    expect(await within(bar()).findByRole("alert")).toHaveTextContent(/weren't sent/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByRole("dialog");
    expect(bar()).toHaveTextContent("1 comment");
  });
});

describe("commenting in place", () => {
  const ELEMENTS = [
    { key: "btn.reject", label: "Reject" },
    { key: "btn.approve", label: "Approve" },
  ];

  async function annotating() {
    const opened = await openReview();
    fireEvent.change(within(opened.dialog).getByLabelText("Flow"), { target: { value: "flow.approve" } });
    annotate(opened.dialog);
    fromFrame({ type: "proto:rendered", screenId: "screen.pending", elements: ELEMENTS });
    return opened;
  }

  it("opens a comment bubble at the clicked element, with the input focused", async () => {
    await annotating();
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();
    clickElement("btn.reject");
    expect(bubble()).toHaveAccessibleName("Comment on Reject");
    expect(within(bubble()).getByLabelText("Comment")).toHaveFocus();
  });

  it("places the bubble by the element, where the frame sits in the console, and follows both", async () => {
    await annotating();
    /** The bubble's left edge in the console's viewport, as it is placed (jsdom lays nothing out; the placement is set inline). */
    const bubbleLeft = async () => {
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      const placed = /translate\((-?[\d.]+)px/.exec(bubble().parentElement!.style.transform);
      return Number(placed?.[1]);
    };
    const frameAt = (left: number) =>
      vi.spyOn(frame(), "getBoundingClientRect").mockReturnValue({ left, top: 64, right: left + 800, bottom: 664, width: 800, height: 600, x: left, y: 64, toJSON: () => ({}) });

    frameAt(100);
    clickElement("btn.reject", { box: { x: 40, y: 120, width: 160, height: 36 } });
    expect(await bubbleLeft()).toBe(140);

    // The prototype scrolled or redrew: the frame re-reports where the element is.
    fromFrame({ type: "proto:geometry", boxes: { "btn.reject": { x: 240, y: 20, width: 160, height: 36 } } });
    expect(await bubbleLeft()).toBe(340);

    // The console's window resized and the frame moved with it.
    frameAt(20);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(await bubbleLeft()).toBe(260);
  });

  it("opens nothing in Preview: a click there acts", async () => {
    await openReview();
    clickElement("btn.new-claim");
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();
  });

  it("adds Shift-clicked elements to the open comment and names them all; a plain click starts another", async () => {
    const { post } = await annotating();
    clickElement("btn.reject");
    fireEvent.change(within(bubble()).getByLabelText("Comment"), { target: { value: "Swap these" } });
    clickElement("btn.approve", { shift: true });
    expect(bubble()).toHaveAccessibleName("Comment on Reject, Approve");
    expect(within(bubble()).getByLabelText("Comment")).toHaveValue("Swap these");
    expect(lastView(post).selectedKeys).toEqual(["btn.reject", "btn.approve"]);

    clickElement("btn.approve");
    expect(bubble()).toHaveAccessibleName("Comment on Approve");
    expect(lastView(post).selectedKeys).toEqual(["btn.approve"]);
  });

  it("queues the comment with Add, closes the bubble and leaves its numbered pin", async () => {
    const { post } = await annotating();
    clickElement("btn.reject");
    expect(within(bubble()).getByRole("button", { name: "Add" })).toBeDisabled();
    addComment("Ask for a reason");
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();
    expect(lastView(post)).toMatchObject({ selectedKeys: [], pins: { "btn.reject": [1] } });
    expect(within(commentList()).getByRole("listitem")).toHaveTextContent("Ask for a reason");
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
  ])("queues the comment with %s+Enter", async (_name, modifier) => {
    const { post } = await annotating();
    clickElement("btn.approve");
    const input = within(bubble()).getByLabelText("Comment");
    fireEvent.change(input, { target: { value: "Make it green" } });
    fireEvent.keyDown(input, { key: "Enter", ...modifier });
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();
    expect(lastView(post).pins).toEqual({ "btn.approve": [1] });
  });

  it("closes the bubble with Escape, then clears the selection, then closes the review", async () => {
    const { dialog, post } = await annotating();
    clickElement("btn.reject");
    fireEvent.keyDown(within(bubble()).getByLabelText("Comment"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();
    expect(lastView(post).selectedKeys).toEqual(["btn.reject"]);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(lastView(post).selectedKeys).toEqual([]);
    expect(screen.getByRole("dialog", { name: "Prototype · Acme Expenses" })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("reopens the bubble on a selection kept after it closed, when an element is Shift-clicked", async () => {
    await annotating();
    clickElement("btn.reject");
    fireEvent.keyDown(within(bubble()).getByLabelText("Comment"), { key: "Escape" });
    clickElement("btn.approve", { shift: true });
    expect(bubble()).toHaveAccessibleName("Comment on Reject, Approve");
  });

  it("closes an empty bubble on a click away from it, but not one holding text", async () => {
    const { dialog } = await annotating();
    const clickAway = async () => {
      // A click away counts once the bubble has settled in, not the very event that opened it.
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      fireEvent.mouseDown(within(dialog).getByText("Prototype · Acme Expenses"));
      fireEvent.click(within(dialog).getByText("Prototype · Acme Expenses"));
    };
    clickElement("btn.reject");
    await clickAway();
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();

    clickElement("btn.reject");
    fireEvent.change(within(bubble()).getByLabelText("Comment"), { target: { value: "Half a thought" } });
    await clickAway();
    expect(within(bubble()).getByLabelText("Comment")).toHaveValue("Half a thought");
  });

  it("holds a comment to the length limit and counts down near it", async () => {
    await annotating();
    clickElement("btn.reject");
    const input = within(bubble()).getByLabelText("Comment");
    expect(input).toHaveAttribute("maxlength", String(MAX_FEEDBACK_TEXT));
    expect(within(bubble()).queryByText(`10 / ${MAX_FEEDBACK_TEXT}`)).toBeNull();
    fireEvent.change(input, { target: { value: "x".repeat(MAX_FEEDBACK_TEXT - 10) } });
    expect(within(bubble()).getByText(`${MAX_FEEDBACK_TEXT - 10} / ${MAX_FEEDBACK_TEXT}`)).toBeInTheDocument();
  });

  it("refuses another comment once the queue is full, and says why", async () => {
    await annotating();
    for (let i = 0; i < MAX_FEEDBACK_REQUESTS; i++) {
      clickElement("btn.reject");
      addComment(`Comment ${i + 1}`);
    }
    clickElement("btn.approve");
    fireEvent.change(within(bubble()).getByLabelText("Comment"), { target: { value: "One more" } });
    expect(within(bubble()).getByRole("button", { name: "Add" })).toBeDisabled();
    expect(within(bar()).getByRole("note")).toHaveTextContent(`The queue is full (${MAX_FEEDBACK_REQUESTS} comments)`);
    expect(within(bar()).getByRole("button", { name: "Comment on screen" })).toBeDisabled();
  });
});

describe("the send bar", () => {
  it("replaces the side panel: the prototype takes the full width, and the bar counts and sends", async () => {
    const { dialog } = await openReview();
    annotate(dialog);
    expect(within(dialog).queryByRole("complementary")).toBeNull();
    expect(bar()).toHaveTextContent("0 comments");
    expect(within(bar()).getByRole("button", { name: "Send to agent" })).toBeDisabled();
    clickElement("btn.new-claim");
    addComment("Call it Submit a claim");
    expect(bar()).toHaveTextContent("1 comment");
    expect(within(bar()).getByRole("button", { name: "Send to agent" })).toBeEnabled();
  });

  it("comments on the whole screen from the bar, even from Preview, and leaves no pin", async () => {
    const { dialog, post } = await openReview();
    fireEvent.click(within(bar()).getByRole("button", { name: "Comment on screen" }));
    expect(within(dialog).getByRole("button", { name: "Annotate" })).toHaveAttribute("aria-pressed", "true");
    expect(bubble()).toHaveAccessibleName("Comment on My claims (whole screen)");
    expect(within(bubble()).getByLabelText("Comment")).toHaveFocus();
    addComment("Too busy overall");
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();
    expect(lastView(post).pins).toEqual({});
    expect(within(commentList()).getByRole("listitem")).toHaveTextContent(/Too busy overall.*Whole screen/);

    fireEvent.click(within(bar()).getByRole("button", { name: "Send to agent" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]![2]).toMatchObject({
      feedback: { requests: [{ screenId: "screen.my-claims", roleId: "employee", stateId: "state.default", elementIds: [], text: "Too busy overall" }] },
    });
  });

  it("opens nothing on a click on empty canvas", async () => {
    const { dialog } = await openReview();
    annotate(dialog);
    fromFrame({ type: "proto:toggle", elementKey: "" });
    expect(screen.queryByRole("dialog", { name: /^Comment on/ })).toBeNull();
  });

  it("lists every comment across screens, roles and states; an entry goes there and opens its bubble", async () => {
    const { dialog } = await openReview();
    fireEvent.change(within(dialog).getByLabelText("Flow"), { target: { value: "flow.approve" } });
    fireEvent.change(within(dialog).getByLabelText("State"), { target: { value: "state.empty" } });
    annotate(dialog);
    fromFrame({ type: "proto:rendered", screenId: "screen.pending", elements: [{ key: "btn.reject", label: "Reject" }] });
    clickElement("btn.reject");
    addComment("Ask for a reason");
    fireEvent.change(within(dialog).getByLabelText("Flow"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "employee" } });
    fireEvent.change(within(dialog).getByLabelText("State"), { target: { value: "state.default" } });
    fireEvent.click(within(bar()).getByRole("button", { name: "Comment on screen" }));
    addComment("Too busy overall");

    const entries = within(commentList()).getAllByRole("listitem");
    expect(entries.map((e) => e.textContent)).toEqual([
      expect.stringMatching(/Ask for a reason.*Pending approvals · Manager · Nothing to show · btn\.reject/),
      expect.stringMatching(/Too busy overall.*My claims · Employee · Default · Whole screen/),
    ]);

    fireEvent.click(within(entries[0]!).getByRole("button", { name: /Ask for a reason/ }));
    expect((within(dialog).getByLabelText("Screen") as HTMLSelectElement).value).toBe("screen.pending");
    expect((within(dialog).getByLabelText("Role") as HTMLSelectElement).value).toBe("manager");
    expect((within(dialog).getByLabelText("State") as HTMLSelectElement).value).toBe("state.empty");
    fromFrame({ type: "proto:geometry", boxes: { "btn.reject": BOX } });
    const opened = screen.getByRole("dialog", { name: "Comment 1" });
    expect(opened).toHaveTextContent("Ask for a reason");

    // A whole-screen comment opens at the bar.
    fireEvent.click(within(commentList()).getByRole("button", { name: /Too busy overall/ }));
    expect((within(dialog).getByLabelText("Screen") as HTMLSelectElement).value).toBe("screen.my-claims");
    expect(screen.getByRole("dialog", { name: "Comment 2" })).toHaveTextContent("Too busy overall");
    expect(screen.queryByRole("dialog", { name: "Comment 1" })).toBeNull();
  });

  it("toggles Annotate with C, but not while typing", async () => {
    const { dialog } = await openReview();
    const mode = () => within(dialog).getByRole("button", { name: "Annotate" }).getAttribute("aria-pressed");
    fireEvent.keyDown(dialog, { key: "c" });
    expect(mode()).toBe("true");
    clickElement("btn.new-claim");
    fireEvent.keyDown(within(bubble()).getByLabelText("Comment"), { key: "c" });
    expect(mode()).toBe("true");
    fireEvent.keyDown(dialog, { key: "C" });
    expect(mode()).toBe("false");
    fireEvent.keyDown(dialog, { key: "c", metaKey: true });
    expect(mode()).toBe("false");
  });
});
