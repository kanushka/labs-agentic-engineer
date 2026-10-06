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
/**
 * Annotate: a click selects (never acts) and opens a comment bubble at the
 * element; added comments leave pins that open back into the bubble; the
 * floating bar counts and lists them and saves them to
 * .prototype/feedback.json for the agent.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_FEEDBACK_REQUESTS, MAX_FEEDBACK_TEXT } from "@wso2/prototype-kit/feedback";
import { app, driver, host } from "./driver.js";
import type { Box, Preview, Target } from "./protocol.js";

/** A queued comment's entry in the bar's list, by a part of its text. */
const entry = (text: string): Target => ({ where: "host", role: "button", name: text, partial: true });
const settle = (pg: string, ms = 300) => driver.evalInApp(pg, `new Promise((r) => setTimeout(r, ${ms}))`);
/** Waits until `read` changes from `before`. */
async function moved(read: () => Promise<Box>, before: Box): Promise<Box> {
  for (let i = 0; i < 50; i++) {
    const now = await read();
    if (now.x !== before.x || now.y !== before.y) return now;
    await new Promise((r) => setTimeout(r, 50));
  }
  return read();
}
/** The bubble is drawn just below or just above `el`, overlapping it across (it is kept inside the window). */
function besides(bubble: Box, el: Box) {
  const below = bubble.y >= el.y + el.height && bubble.y - (el.y + el.height) < 24;
  const above = bubble.y + bubble.height <= el.y && el.y - (bubble.y + bubble.height) < 24;
  expect(below || above, `bubble ${JSON.stringify(bubble)} beside ${JSON.stringify(el)}`).toBe(true);
  expect(bubble.x <= el.x + el.width && bubble.x + bubble.width >= el.x, `bubble ${JSON.stringify(bubble)} across ${JSON.stringify(el)}`).toBe(true);
}

async function open(fixture: string, heading: string) {
  const p = await driver.startPreview(fixture);
  const pg = await driver.openPage(p.url);
  await driver.waitFor(pg, app.heading(heading));
  return { p, pg };
}

async function annotate(pg: string) {
  await driver.click(pg, host.button("Annotate"));
  await driver.frameMode(pg, "annotate");
}

/** Somewhere on the host page outside any bubble: the toolbar's title. */
const outside: Target = { where: "host", role: "heading", name: "Contacts" };

let preview: Preview;
let page: string;

beforeAll(async () => {
  ({ p: preview, pg: page } = await open("contacts", "Acme contacts"));
});

afterAll(async () => {
  await driver.closePage(page);
  await driver.stopPreview(preview.id);
});

describe("prototype preview — commenting in Annotate", () => {
  it("opens a bubble at the clicked element, queues with Add and Cmd/Ctrl+Enter, and saves the feedback file", async () => {
    await annotate(page);
    expect(await driver.read(page, host.button("Annotate"), "pressed")).toBe("true");

    // A click on the button selects it and opens the bubble beside it; it does not navigate.
    await driver.click(page, app.element("btn.new"));
    await driver.waitFor(page, host.dialog("Comment on New contact"));
    expect(await driver.read(page, app.element("btn.new"), "pressed")).toBe("true");
    expect(await driver.read(page, host.picker("Screen"), "value")).toBe("screen.contacts");
    besides(await driver.box(page, host.dialog("Comment on New contact")), await driver.box(page, app.element("btn.new")));
    await driver.fill(page, host.field("Comment"), "Make this button green");
    await driver.click(page, host.button("Add"));
    await driver.waitFor(page, host.dialog("Comment on New contact"), "hidden");
    await driver.waitFor(page, app.button("Comment 1"));
    expect(await driver.read(page, app.element("btn.new"), "pressed")).toBe("false");

    await driver.click(page, app.element("heading.contacts"));
    await driver.fill(page, host.field("Comment"), "Call this page People");
    await driver.press(page, host.field("Comment"), "ControlOrMeta+Enter");
    await driver.waitFor(page, app.button("Comment 2"));
    await driver.waitFor(page, host.button("2 comments"));

    await driver.click(page, host.button("Save feedback"));
    await driver.waitFor(page, host.text("Saved 2 comments to .prototype/feedback.json"));
    const saved = JSON.parse((await driver.readFile(preview.id, ".prototype/feedback.json"))!) as Record<string, unknown>;
    expect(saved).toEqual({
      schemaVersion: 1,
      savedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      prototypeHash: await driver.revisionHash(preview.id),
      requests: [
        { screenId: "screen.contacts", roleId: "editor", stateId: "state.default", elementIds: ["btn.new"], text: "Make this button green" },
        { screenId: "screen.contacts", roleId: "editor", stateId: "state.default", elementIds: ["heading.contacts"], text: "Call this page People" },
      ],
    });
  });

  it("points one comment at several elements with Shift-click, keeping what was typed", async () => {
    await driver.click(page, app.element("nav.settings"));
    await driver.fill(page, host.field("Comment"), "Group these");
    await driver.clickWith(page, app.element("nav.contacts"), "Shift");
    await driver.waitFor(page, host.dialog("Comment on Settings, Contacts"));
    expect(await driver.read(page, host.field("Comment"), "value")).toBe("Group these");
    await driver.click(page, host.button("Add"));
    await driver.waitFor(page, host.button("3 comments"));
    // Selecting does not follow a navigating control.
    expect(await driver.read(page, host.picker("Screen"), "value")).toBe("screen.contacts");
    expect(await driver.count(page, app.heading("Settings"))).toBe(0);
  });

  it("keeps the bubble at its element as the prototype scrolls and the window resizes", async () => {
    await driver.evalInApp(page, `document.body.style.paddingBottom = "2000px"`);
    await driver.click(page, app.element("heading.contacts"));
    const bubble = host.dialog("Comment on Acme contacts");
    await driver.waitFor(page, bubble);
    const before = await driver.box(page, bubble);
    await driver.evalInApp(page, `window.scrollBy(0, 40)`);
    const scrolled = await moved(() => driver.box(page, bubble), before);
    expect(scrolled.y).toBeCloseTo(before.y - 40, 0);
    besides(scrolled, await driver.box(page, app.element("heading.contacts")));

    await driver.resize(page, 900, 700);
    await settle(page);
    besides(await driver.box(page, bubble), await driver.box(page, app.element("heading.contacts")));
    await driver.resize(page, 1280, 720);
    await driver.evalInApp(page, `window.scrollTo(0, 0); document.body.style.paddingBottom = ""`);
    await driver.pressKey(page, "Escape");
    await driver.pressKey(page, "Escape");
  });

  it("opens a pin to read, edit and remove its comment", async () => {
    await driver.click(page, app.button("Comment 1"));
    await driver.waitFor(page, host.dialog("Comment 1"));
    expect(await driver.read(page, host.dialog("Comment 1"), "text")).toContain("Make this button green");
    await driver.click(page, host.button("Edit"));
    await driver.fill(page, host.field("Comment"), "Make this button blue");
    await driver.click(page, host.button("Save"));
    await driver.waitFor(page, host.text("Make this button blue"));

    await driver.click(page, app.button("Comment 2"));
    await driver.click(page, host.button("Remove"));
    await driver.waitFor(page, host.dialog("Comment 2"), "hidden");
    await driver.waitFor(page, host.button("2 comments"));
    // The rest renumber: the Shift-click comment is 2 now.
    await driver.click(page, host.button("2 comments"));
    expect(await driver.read(page, { where: "host", role: "list", name: "Queued comments" }, "text")).not.toContain("Call this page People");
    await driver.click(page, host.button("2 comments"));
  });

  it("opens pins in Preview too, without acting", async () => {
    await driver.click(page, host.button("Preview"));
    await driver.frameMode(page, "preview");
    await driver.click(page, app.button("Comment 1"));
    await driver.waitFor(page, host.dialog("Comment 1"));
    expect(await driver.read(page, host.picker("Screen"), "value")).toBe("screen.contacts");
    await driver.pressKey(page, "Escape");
    await driver.waitFor(page, host.dialog("Comment 1"), "hidden");
  });

  it("keeps typed text as a hollow draft pin on a click away, and restores it when reopened", async () => {
    await annotate(page);
    await driver.click(page, app.element("heading.contacts"));
    await driver.fill(page, host.field("Comment"), "Half a thought");
    await driver.click(page, outside); // the toolbar's title, outside the bubble
    await driver.waitFor(page, host.dialog("Comment on Acme contacts"), "hidden");
    await driver.waitFor(page, app.button("Draft comment"));
    await driver.waitFor(page, host.button("2 comments")); // a draft is not counted

    await driver.click(page, app.button("Draft comment"));
    await driver.waitFor(page, host.dialog("Comment on Acme contacts"));
    expect(await driver.read(page, host.field("Comment"), "value")).toBe("Half a thought");
    await driver.pressKey(page, "Escape");
    await driver.pressKey(page, "Escape");
  });

  it("closes an empty bubble without a draft", async () => {
    await driver.click(page, app.element("btn.new"));
    await driver.waitFor(page, host.dialog("Comment on New contact"));
    await driver.click(page, outside);
    await driver.waitFor(page, host.dialog("Comment on New contact"), "hidden");
    expect(await driver.count(page, app.button("Draft comment"))).toBe(1);
  });

  it("comments on the whole screen from the bar, keeping its text as a draft when clicked away", async () => {
    await driver.click(page, host.button("Comment on screen"));
    const bubble = host.dialog("Comment on Contacts (whole screen)");
    await driver.waitFor(page, bubble);
    await driver.fill(page, host.field("Comment"), "Too much whitespace");
    await driver.click(page, outside);
    await driver.waitFor(page, bubble, "hidden");
    await driver.click(page, host.button("Comment on screen"));
    expect(await driver.read(page, host.field("Comment"), "value")).toBe("Too much whitespace");
    await driver.click(page, host.button("Add"));
    await driver.waitFor(page, host.button("3 comments"));
    await driver.click(page, host.button("3 comments"));
    expect(await driver.read(page, entry("Too much whitespace"), "text")).toContain("Whole screen");
    await driver.click(page, host.button("3 comments"));
  });

  it("lists comments across screens and states; an entry goes there and opens it", async () => {
    await driver.select(page, host.picker("State"), "Empty");
    await driver.click(page, app.element("heading.contacts"));
    await driver.fill(page, host.field("Comment"), "Say why it is empty");
    await driver.click(page, host.button("Add"));
    await driver.select(page, host.picker("State"), "Default");
    await driver.select(page, host.picker("Screen"), "Settings");
    await driver.waitFor(page, app.heading("Settings"));

    await driver.click(page, host.button("4 comments"));
    await driver.click(page, entry("Say why it is empty"));
    await driver.waitFor(page, host.dialog("Comment 4"));
    expect(await driver.read(page, host.picker("Screen"), "value")).toBe("screen.contacts");
    expect(await driver.read(page, host.picker("State"), "value")).toBe("state.empty");
    expect(await driver.read(page, host.button("Annotate"), "pressed")).toBe("true");
    await driver.pressKey(page, "Escape");
  });

  it("toggles Annotate with C, but not while typing", async () => {
    await driver.pressKey(page, "c");
    expect(await driver.read(page, host.button("Preview"), "pressed")).toBe("true");
    await driver.pressKey(page, "c");
    expect(await driver.read(page, host.button("Annotate"), "pressed")).toBe("true");
    await driver.click(page, app.element("btn.new"));
    await driver.press(page, host.field("Comment"), "c");
    expect(await driver.read(page, host.field("Comment"), "value")).toBe("c");
    expect(await driver.read(page, host.button("Annotate"), "pressed")).toBe("true");
  });

  it("undoes the nearest thing on Escape: the bubble, then the selection", async () => {
    // The bubble from the last test is open on btn.new.
    await driver.pressKey(page, "Escape");
    await driver.waitFor(page, host.dialog("Comment on New contact"), "hidden");
    expect(await driver.read(page, app.element("btn.new"), "pressed")).toBe("true");
    await driver.pressKey(page, "Escape");
    expect(await driver.read(page, app.element("btn.new"), "pressed")).toBe("false");
  });

  it("acts again in Preview", async () => {
    await driver.click(page, host.button("Preview"));
    await driver.frameMode(page, "preview");
    await driver.click(page, app.button("New contact"));
    await driver.waitFor(page, app.heading("New contact"));
  });
});

describe("prototype preview — Annotate across a revision", () => {
  it("keeps the queue, marks the comment written on the earlier version, and saves the original hash", async () => {
    const { p, pg } = await open("contacts", "Acme contacts");
    try {
      const originalHash = await driver.revisionHash(p.id);
      await annotate(pg);
      await driver.click(pg, app.element("btn.new"));
      await driver.fill(pg, host.field("Comment"), "Make this button green");
      await driver.click(pg, host.button("Add"));
      const source = (await driver.readFile(p.id, "prototype.tsx"))!;
      await driver.writeFile(p.id, "prototype.tsx", source.replace("`${company} contacts`", "`${company} people`"));
      await driver.waitFor(pg, app.heading("Acme people"));
      await driver.waitFor(pg, host.text("1 comment was written on an earlier version of the prototype."));
      // A comment written on the revision showing is not marked.
      await driver.click(pg, host.button("Comment on screen"));
      await driver.fill(pg, host.field("Comment"), "Say people, not contacts");
      await driver.click(pg, host.button("Add"));
      await driver.waitFor(pg, host.text("2 comments"));
      await driver.waitFor(pg, host.text("1 comment was written on an earlier version of the prototype."));
      await driver.click(pg, host.button("Save feedback"));
      await driver.waitFor(pg, host.text("Saved 2 comments to .prototype/feedback.json"));
      const saved = JSON.parse((await driver.readFile(p.id, ".prototype/feedback.json"))!) as { prototypeHash: string };
      expect(saved.prototypeHash).toBe(originalHash);
      expect(await driver.revisionHash(p.id)).not.toBe(originalHash);
    } finally {
      await driver.closePage(pg);
      await driver.stopPreview(p.id);
    }
  });
});

describe("prototype preview — Annotate limits", () => {
  it("limits the comment to what the server accepts and stops adding at the queue cap, saying why", async () => {
    const { p, pg } = await open("contacts", "Acme contacts");
    try {
      await annotate(pg);
      await driver.click(pg, host.button("Comment on screen"));
      expect(await driver.read(pg, host.field("Comment"), "maxlength")).toBe(String(MAX_FEEDBACK_TEXT));
      await driver.fill(pg, host.field("Comment"), "x".repeat(MAX_FEEDBACK_TEXT - 10));
      await driver.waitFor(pg, host.text(`${MAX_FEEDBACK_TEXT - 10} / ${MAX_FEEDBACK_TEXT}`));
      await driver.fill(pg, host.field("Comment"), "Fine");
      await driver.click(pg, host.button("Add"));
      for (let i = 1; i < MAX_FEEDBACK_REQUESTS; i++) {
        await driver.click(pg, host.button("Comment on screen"));
        await driver.fill(pg, host.field("Comment"), "Fine");
        await driver.click(pg, host.button("Add"));
      }
      await driver.waitFor(pg, host.text(`The queue is full (${MAX_FEEDBACK_REQUESTS} comments)`, true));
      expect(await driver.read(pg, host.button("Comment on screen"), "disabled")).toBe("true");
      await driver.click(pg, app.element("btn.new"));
      await driver.fill(pg, host.field("Comment"), "One more");
      expect(await driver.read(pg, host.button("Add"), "disabled")).toBe("true");
      await driver.click(pg, host.button("Save feedback"));
      await driver.waitFor(pg, host.text(`Saved ${MAX_FEEDBACK_REQUESTS} comments to .prototype/feedback.json`));
    } finally {
      await driver.closePage(pg);
      await driver.stopPreview(p.id);
    }
  });
});

describe("prototype preview — Escape in the prototype", () => {
  it("clears the selection on Escape in the app, but not on Escape in a focused form control", async () => {
    const { p, pg } = await open("expense-approval", "Approval queue");
    try {
      await annotate(pg);
      await driver.click(pg, app.element("heading.queue"));
      await driver.waitFor(pg, host.dialog("Comment on Approval queue"));
      await driver.pressKey(pg, "Escape");
      await driver.waitFor(pg, host.dialog("Comment on Approval queue"), "hidden");
      expect(await driver.read(pg, app.element("heading.queue"), "pressed")).toBe("true");

      // Annotate makes the controls read-only, so enable one: Escape closing its native picker is the prototype's own,
      // and the host must leave the selection alone.
      await driver.evalInApp(pg, `document.querySelectorAll("select").forEach((s) => (s.disabled = false))`);
      await driver.press(pg, { where: "app", role: "combobox", name: "Team" }, "Escape");
      await settle(pg, 500);
      expect(await driver.read(pg, app.element("heading.queue"), "pressed")).toBe("true");

      // Escape on the app's page itself is the host's.
      await driver.evalInApp(pg, `document.activeElement.blur(); document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await settle(pg);
      expect(await driver.read(pg, app.element("heading.queue"), "pressed")).toBe("false");
    } finally {
      await driver.closePage(pg);
      await driver.stopPreview(p.id);
    }
  });
});
