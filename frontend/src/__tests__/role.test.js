import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Role, clearRole, loadRole, saveDoctorRole } from "../pairing/role.js";

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the device's role", () => {
  it("is nothing until this device has been chosen", () => {
    expect(loadRole()).toBeNull();
  });

  it("remembers a doctor's device", () => {
    saveDoctorRole();

    expect(loadRole()).toBe(Role.DOCTOR);
  });

  it("returns the role, so a caller can put it straight into state", () => {
    expect(saveDoctorRole()).toBe("doctor");
  });

  it("can be cleared", () => {
    saveDoctorRole();

    clearRole();

    expect(loadRole()).toBeNull();
  });

  it("does not expire, unlike a visit: it says what the device is for", () => {
    localStorage.setItem("tiemeghana.role", "doctor");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000 * 60 * 60 * 24 * 365);

    expect(loadRole()).toBe("doctor");
  });

  it("never treats anything else in storage as a role", () => {
    // A patient is not remembered, and a stray value is not a doctor.
    localStorage.setItem("tiemeghana.role", "patient");
    expect(loadRole()).toBeNull();

    localStorage.setItem("tiemeghana.role", "administrator");
    expect(loadRole()).toBeNull();
  });

  it("survives storage being unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(loadRole()).toBeNull();
    expect(() => saveDoctorRole()).not.toThrow();
  });
});
