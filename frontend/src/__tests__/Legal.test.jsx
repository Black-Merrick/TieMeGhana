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

describe("the footer stays reachable", () => {
  /**
   * The consultation and emergency screens lock themselves to the viewport and
   * hide the overflow, so anything below the panes is not merely out of view,
   * it cannot be scrolled to at all. A footer placed there without allowing for
   * it would be links that do not exist.
   *
   * Asserted against the stylesheet because jsdom has no layout engine and so
   * cannot be asked where an element ended up.
   */
  const css = () => read("src/index.css");

  it("the locked layout keeps a row for the footer", () => {
    expect(css()).toMatch(
      /\.app--split \.legal-footer \{\s*flex: 0 0 auto;/,
    );
  });

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
