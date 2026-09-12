import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../App.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App shell", () => {
  it("reports a connected system when the health check succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok", database: "ok" }),
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("connection-status")).toHaveTextContent(
        "Connected to the hospital system",
      );
    });
  });

  it("falls back to an offline message when the API is unreachable", async () => {
    // NFR 5, the app must stay usable under intermittent connectivity, so a
    // failed health check has to degrade visibly rather than hang on checking.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("connection-status")).toHaveTextContent(
        "Offline, cached content only",
      );
    });
  });
});
