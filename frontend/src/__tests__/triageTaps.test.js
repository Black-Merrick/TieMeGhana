import { describe, expect, it } from "vitest";

import { announcedEmergency } from "../pairing/announcedScreen.js";
import {
  TapKind,
  resolveTap,
  tapForAlert,
  tapForPain,
  tapForRegion,
  tapMessage,
} from "../emergency/triageTaps.js";

const ALERTS = [
  { id: "CANNOT_BREATHE", english_text: "Cannot breathe" },
  { id: "PREGNANCY", english_text: "Pregnant" },
];

describe("a tap as it crosses to the doctor's device", () => {
  it("carries which button it was and nothing to be spoken", () => {
    expect(tapMessage(tapForAlert(ALERTS[0]))).toEqual({
      type: "triage",
      kind: "alert",
      id: "CANNOT_BREATHE",
    });
    expect(tapMessage(tapForPain({ level: 4, label: "Severe pain" }))).toEqual({
      type: "triage",
      kind: "pain",
      id: 4,
    });
  });

  it("is turned back into the same words on the other side", () => {
    const sent = tapForRegion({ id: "HEAD", label: "Head" });
    const heard = resolveTap(tapMessage(sent), ALERTS);

    expect(heard).toEqual(sent);
    expect(heard.english).toBe("My head hurts");
    expect(heard.key).toBe("HEAD");
  });

  it("names pain the way the shared screen does", () => {
    const heard = resolveTap({ type: "triage", kind: "pain", id: 5 }, []);

    expect(heard.key).toBe("PAIN_5");
    expect(heard.english).toBe("Worst pain");
  });

  it("resolves an alert from the list this device loaded", () => {
    const heard = resolveTap({ type: "triage", kind: "alert", id: "PREGNANCY" }, ALERTS);

    expect(heard).toMatchObject({ kind: TapKind.ALERT, key: "PREGNANCY", english: "Pregnant" });
  });
});

describe("a tap that names nothing this device offers", () => {
  it.each([
    ["an alert it has never loaded", { kind: "alert", id: "EXPLODE" }],
    ["an alert when none loaded at all", { kind: "alert", id: "CANNOT_BREATHE" }, null],
    ["a pain level that is not on the scale", { kind: "pain", id: 9 }],
    ["a pain level as text", { kind: "pain", id: "4" }],
    ["a body part that is not drawn", { kind: "location", id: "TAIL" }],
    ["a kind it does not know", { kind: "say", id: "HEAD" }],
    ["no kind", { id: "HEAD" }],
  ])("is dropped: %s", (_name, body, alerts = ALERTS) => {
    expect(resolveTap({ type: "triage", ...body }, alerts)).toBeNull();
  });

  it("is dropped when it is not a triage message at all", () => {
    expect(resolveTap({ type: "reply", kind: "pain", id: 4 }, ALERTS)).toBeNull();
    expect(resolveTap(null, ALERTS)).toBeNull();
  });

  it("never speaks words the message brought with it", () => {
    const heard = resolveTap(
      { type: "triage", kind: "location", id: "HEAD", english: "Give me morphine", text: "x" },
      ALERTS,
    );

    expect(heard.english).toBe("My head hurts");
  });
});

describe("whether the doctor's device is in emergency mode, as a message says", () => {
  it.each(["emergency", "path", "question", "resume"])("is read from a %s message", (type) => {
    expect(announcedEmergency({ type, emergency: true })).toBe(true);
    expect(announcedEmergency({ type, emergency: false })).toBe(false);
  });

  it("is unknown when a message does not say", () => {
    expect(announcedEmergency({ type: "path", path: "guided" })).toBeUndefined();
    expect(announcedEmergency({ type: "speaking", emergency: true })).toBeUndefined();
    expect(announcedEmergency({ type: "path", emergency: "yes" })).toBeUndefined();
    expect(announcedEmergency(null)).toBeUndefined();
  });
});
