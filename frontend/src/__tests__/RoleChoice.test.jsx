import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import RoleChoice from "../components/RoleChoice.jsx";

describe("who is using this device", () => {
  it("asks", () => {
    render(<RoleChoice onDoctor={vi.fn()} onPatient={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /who is using this device/i }),
    ).toBeInTheDocument();
  });

  it("offers a way in for a doctor and one for a patient", () => {
    render(<RoleChoice onDoctor={vi.fn()} onPatient={vi.fn()} />);

    expect(screen.getByTestId("role-doctor")).toHaveTextContent(/i'm a doctor/i);
    expect(screen.getByTestId("role-patient")).toHaveTextContent(/i'm a patient/i);
  });

  it("tells the patient where their code goes", () => {
    render(<RoleChoice onDoctor={vi.fn()} onPatient={vi.fn()} />);

    expect(screen.getByTestId("role-patient")).toHaveTextContent(/code/i);
  });

  it("goes the doctor's way on the doctor card only", async () => {
    const onDoctor = vi.fn();
    const onPatient = vi.fn();
    render(<RoleChoice onDoctor={onDoctor} onPatient={onPatient} />);

    await userEvent.click(screen.getByTestId("role-doctor"));

    expect(onDoctor).toHaveBeenCalledTimes(1);
    expect(onPatient).not.toHaveBeenCalled();
  });

  it("goes the patient's way on the patient card only", async () => {
    const onDoctor = vi.fn();
    const onPatient = vi.fn();
    render(<RoleChoice onDoctor={onDoctor} onPatient={onPatient} />);

    await userEvent.click(screen.getByTestId("role-patient"));

    expect(onPatient).toHaveBeenCalledTimes(1);
    expect(onDoctor).not.toHaveBeenCalled();
  });

  it("is real buttons, reachable by keyboard", async () => {
    const onPatient = vi.fn();
    render(<RoleChoice onDoctor={vi.fn()} onPatient={onPatient} />);

    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");

    expect(onPatient).toHaveBeenCalled();
  });

  it("plays no sign video: it is asked of whoever holds the device", () => {
    render(<RoleChoice onDoctor={vi.fn()} onPatient={vi.fn()} />);

    expect(document.querySelector("video")).toBeNull();
  });
});
