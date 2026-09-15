/**
 * The privacy policy and the terms.
 *
 * Two kinds of test here. The first are ordinary: the documents are reachable,
 * have their own addresses, and do not destroy a consultation to open.
 *
 * The second kind matter more. A privacy policy that overstates protection is
 * worse than none, because it invites a patient to disclose something on a
 * promise the software does not keep. So the load bearing claims are asserted
 * against the code that has to keep them, and if that code changes, these fail
 * rather than the document quietly becoming a lie.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LegalDocument,
  legalDocumentFromPath,
  pathForLegalDocument,
} from "../legal/documents.js";
import LegalScreen from "../legal/LegalScreen.jsx";

const read = (relative) =>
  readFileSync(resolve(process.cwd(), relative), "utf8");

describe("finding the documents by address", () => {
  it("recognises the two paths", () => {
    expect(legalDocumentFromPath("/privacy")).toBe(LegalDocument.PRIVACY);
    expect(legalDocumentFromPath("/terms")).toBe(LegalDocument.TERMS);
  });

  it("tolerates a trailing slash, which forwarded links grow", () => {
    expect(legalDocumentFromPath("/privacy/")).toBe(LegalDocument.PRIVACY);
  });

  it("is not case sensitive", () => {
    expect(legalDocumentFromPath("/Privacy")).toBe(LegalDocument.PRIVACY);
  });

  it("leaves every other address to the app", () => {
    expect(legalDocumentFromPath("/")).toBeNull();
    expect(legalDocumentFromPath("/p/abc123")).toBeNull();
  });

  it("gives each document an address of its own", () => {
    // They are read at different moments and by different people, so each has
    // to be something you can send to somebody on its own.
    expect(pathForLegalDocument(LegalDocument.PRIVACY)).toBe("/privacy");
    expect(pathForLegalDocument(LegalDocument.TERMS)).toBe("/terms");
  });
});

describe("reading them", () => {
  let user;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("shows the privacy policy", () => {
    render(
      <LegalScreen
        document={LegalDocument.PRIVACY}
        onOpen={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /privacy policy/i }),
    ).toBeInTheDocument();
  });

  it("shows the terms", () => {
    render(
      <LegalScreen
        document={LegalDocument.TERMS}
        onOpen={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /terms of use/i }),
    ).toBeInTheDocument();
  });

  it("offers the other document without going back first", async () => {
    const onOpen = vi.fn();
    render(
      <LegalScreen
        document={LegalDocument.PRIVACY}
        onOpen={onOpen}
        onLeave={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("switch-legal"));

    expect(onOpen).toHaveBeenCalledWith(LegalDocument.TERMS);
  });

  it("offers a way back to the app", async () => {
    const onLeave = vi.fn();
    render(
      <LegalScreen
        document={LegalDocument.TERMS}
        onOpen={vi.fn()}
        onLeave={onLeave}
      />,
    );

    await user.click(screen.getByTestId("leave-legal"));

    expect(onLeave).toHaveBeenCalled();
  });
});

describe("the claims the privacy policy makes", () => {
  /**
   * Each of these asserts a sentence in the document against the code that has
   * to keep it true. They are the reason the policy can be trusted.
   */

  it("is right that the transcript has nowhere to be sent", () => {
    // The policy says the record of the visit is never transmitted, and that a
    // test fails the build if a route for one ever appears. That test exists;
    // this asserts it still does, so the two cannot drift apart.
    const guard = read("../backend/core/test_no_transcript_endpoint.py");

    expect(guard).toContain("transcript");
    expect(guard).toContain("def test_no_route_could_carry_a_transcript");
  });

  it("is right that a prescription has no field for a patient", () => {
    // The policy says the record has no space to hold a name: not one left
    // blank, not one hidden from the screen. That is ADR 044, enforced by the
    // model's own shape.
    //
    // Asserted against the field declarations rather than against the text of
    // the file. The first version of this searched for "patient" anywhere in
    // the class and failed on the comment explaining why there is no patient
    // field, which is prose agreeing with the policy rather than contradicting
    // it. Pinning the fields is both stricter and correct: a new column is a
    // change to this list, whatever it is called.
    const model = read("../backend/prescriptions/models.py");
    const prescription = model.slice(
      model.indexOf("class Prescription(models.Model)"),
      model.indexOf("class PrescriptionItem"),
    );

    const fields = [...prescription.matchAll(/^\s{4}(\w+)\s*=\s*models\./gm)].map(
      (match) => match[1],
    );

    expect(fields.sort()).toEqual(["created_at", "reference"]);
  });

  it("is right that medicine photographs are stripped of hidden data", () => {
    // The policy says GPS coordinates, phone model and timestamp are removed by
    // decoding and rewriting the pixels. That is what images.py does.
    const images = read("../backend/prescriptions/images.py");

    expect(images).toContain("putdata");
    expect(images).toMatch(/EXIF/);
  });

  it("is right that the reference is sixteen random bytes", () => {
    const model = read("../backend/prescriptions/models.py");

    expect(model).toContain("REFERENCE_BYTES = 16");
    expect(model).toContain("secrets.token_urlsafe");
  });

  it("is right that nothing is tracked", () => {
    // The policy says there is no analytics, advertising or third party
    // script. The page the browser loads is where one would have to appear.
    const page = read("index.html");

    expect(page).not.toMatch(
      /googletagmanager|google-analytics|gtag|facebook|hotjar|mixpanel|segment\.io/i,
    );
  });

  it("names a real address people can actually write to", () => {
    // A policy with no reachable contact fails Ghana's Data Protection Act and
    // is useless to the person it is written for.
    render(
      <LegalScreen
        document={LegalDocument.PRIVACY}
        onOpen={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(
      links.some((link) => link.getAttribute("href")?.startsWith("mailto:")),
    ).toBe(true);
  });
});

describe("what the documents must say plainly", () => {
  it("the privacy policy leads with what is not collected", () => {
    render(
      <LegalScreen
        document={LegalDocument.PRIVACY}
        onOpen={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    const summary = within(screen.getByText(/the short version/i).closest("section"));
    expect(summary.getByText(/never ask for your name/i)).toBeInTheDocument();
  });

  it("the terms say this is not an interpreter", async () => {
    // The single most important sentence in either document. A clinician who
    // reads nothing else has to meet this one.
    render(
      <LegalScreen
        document={LegalDocument.TERMS}
        onOpen={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    const summary = within(
      screen.getByText(/before you rely on this/i).closest("section"),
    );
    expect(summary.getByText(/not a qualified sign language/i)).toBeInTheDocument();
  });

  it("both say the app is a pilot rather than cleared for clinical use", () => {
    for (const document of [LegalDocument.PRIVACY, LegalDocument.TERMS]) {
      const { unmount } = render(
        <LegalScreen document={document} onOpen={vi.fn()} onLeave={vi.fn()} />,
      );

      expect(screen.getByText(/clinical use/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("carries no unfilled placeholder text", () => {
    // A policy shipped with a bracketed blank in it tells the reader nobody
    // checked, which undermines every other sentence in the document.
    for (const file of ["src/legal/PrivacyPolicy.jsx", "src/legal/TermsOfUse.jsx"]) {
      const source = read(file);

      expect(source).not.toMatch(/\[(company|name|address|email|date|insert)/i);
      expect(source).not.toMatch(/lorem ipsum|TODO|TBD|XXX|your company/i);
    }
  });
});

describe("the split layout has room for its content", () => {
  /**
   * Asserted against the stylesheet because jsdom has no layout engine and so
   * cannot be asked where an element ended up.
   */
  const css = () => read("src/index.css");

  it("the layout only locks when the viewport is tall enough for it", () => {
    // On a 1366 by 768 laptop the panes were dividing about 640 pixels, which
    // cut the body map off at the knees and left no way to reach anything
    // below. Below this height the page scrolls instead.
    const stylesheet = css();
    const lock = stylesheet.indexOf(".app--split {\n    height: 100dvh;");
    const query = stylesheet.lastIndexOf("@media", lock);

    expect(stylesheet.slice(query, lock)).toContain("min-height");
  });

  it("the two column layout is not gated on height", () => {
    // A short wide screen should keep its columns and simply scroll. Losing
    // them would turn a laptop into a phone layout.
    const stylesheet = css();
    const columns = stylesheet.indexOf(".consult {\n    grid-template-columns:");
    const query = stylesheet.lastIndexOf("@media", columns);

    expect(stylesheet.slice(query, columns)).not.toContain("min-height");
  });
});

describe("the user manual", () => {
  /**
   * A PDF with screenshots and numbered callouts, built by
   * frontend/tools/build-manual.mjs from a live capture of the running app.
   */

  it("is a file that exists and is shipped with the app", () => {
    // public/ is copied verbatim into the build, so a missing file here is a
    // 404 on a link a clinician follows when they are already confused.
    const pdf = readFileSync(
      resolve(process.cwd(), "public", "tie-me-ghana-manual.pdf"),
    );

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(100_000);
  });

  it("is linked from the footer at the address it is published to", () => {
    // The two would otherwise drift: the build writes one name and the link
    // points at another, which nothing fails on until somebody clicks it.
    const app = read("src/App.jsx");
    const builder = read("tools/build-manual.mjs");

    expect(app).toContain('"/tie-me-ghana-manual.pdf"');
    expect(builder).toContain('"tie-me-ghana-manual.pdf"');
  });

  it("opens beside the app rather than replacing it", () => {
    // Somebody reaches for a manual while stuck in the app. Navigating away
    // from a half finished consultation to read about it would be unkind.
    const app = read("src/App.jsx");
    const link = app.slice(app.indexOf("href={MANUAL_PDF}"));

    expect(link.slice(0, 200)).toContain('target="_blank"');
    expect(link.slice(0, 200)).toContain('rel="noopener"');
  });

  it("every callout drawn on a screenshot has an explanation", () => {
    // A number on a picture with nothing beside it is an arrow pointing at a
    // button and saying nothing about it.
    const captured = JSON.parse(read("../docs/manual/screens.json"));
    const builder = read("tools/build-manual.mjs");

    const unexplained = [];
    for (const screen of captured.screens) {
      for (const callout of screen.callouts) {
        // The explanations are keyed by the selector the capture measured, and
        // written in the source exactly as the capture records it. Compared
        // raw: JSON encoding it escaped the inner quotes, which appear nowhere
        // in the file, so every selector looked missing.
        if (!builder.includes(callout.selector)) {
          unexplained.push(`${screen.id}: ${callout.selector}`);
        }
      }
    }

    expect(unexplained).toEqual([]);
  });

  it("documents every screen a clinician has to operate", () => {
    const captured = JSON.parse(read("../docs/manual/screens.json"));
    const ids = captured.screens.map((screen) => screen.id).sort();

    expect(ids).toEqual([
      "consultation",
      "emergency",
      "guided",
      "opening",
      "prescription",
    ]);
  });

  it("measured every callout it set out to, none silently missing", () => {
    // The capture warns when a selector matches nothing, but a warning in a
    // build log is not a guard. An empty screen would mean a figure with no
    // callouts at all, printed as though it were finished.
    const captured = JSON.parse(read("../docs/manual/screens.json"));

    for (const screen of captured.screens) {
      expect(screen.callouts.length).toBeGreaterThan(0);
      for (const callout of screen.callouts) {
        expect(callout.width).toBeGreaterThan(0);
        expect(callout.height).toBeGreaterThan(0);
      }
    }
  });
});

describe("the README's screenshots", () => {
  /**
   * Broken images on a repository's front page are the first thing anyone
   * sees, and nothing in a normal build notices them: markdown is not
   * compiled, so a renamed or deleted screenshot stays a working file path
   * right up until somebody opens the page.
   */

  it("all point at files that exist", () => {
    const readme = read("../README.md");
    const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);

    expect(images.length).toBeGreaterThan(0);

    const missing = images.filter((path) => {
      try {
        readFileSync(resolve(process.cwd(), "..", path));
        return false;
      } catch {
        return true;
      }
    });

    expect(missing).toEqual([]);
  });

  it("show the screens the manual documents, from the same capture", () => {
    // The README and the manual draw on one set of screenshots, so what the
    // repository advertises and what the manual explains cannot diverge.
    const readme = read("../README.md");
    const captured = JSON.parse(read("../docs/manual/screens.json"));

    for (const screen of captured.screens) {
      expect(readme).toContain(`docs/manual/shots/${screen.id}.png`);
    }
  });

  it("links the manual at the path the build writes it to", () => {
    const readme = read("../README.md");

    expect(readme).toContain("frontend/public/tie-me-ghana-manual.pdf");
  });

  it("carries no alt text that would be useless to a screen reader", () => {
    // A README is read by people who cannot see the screenshots too, and
    // "screenshot" as alt text tells them nothing at all.
    const readme = read("../README.md");
    const alts = [...readme.matchAll(/!\[([^\]]*)\]\([^)]+\)/g)].map((m) => m[1]);

    for (const alt of alts) {
      expect(alt.length).toBeGreaterThan(20);
      expect(alt.toLowerCase()).not.toMatch(/^(screenshot|image|picture)$/);
    }
  });
});
