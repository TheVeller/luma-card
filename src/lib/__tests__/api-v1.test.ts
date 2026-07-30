import { describe, expect, test } from "bun:test";
import { apiError, decodeCursor, encodeCursor, healthResponse } from "../api-v1.server";

describe("external API helpers", () => {
  test("keeps cursors opaque and round-trippable", () => {
    const cursor = encodeCursor(1250);
    expect(cursor).not.toBe("1250");
    expect(decodeCursor(cursor)).toBe(1250);
    expect(decodeCursor("not-a-cursor")).toBeNull();
  });

  test("returns a stable structured error with request id", async () => {
    const response = apiError(422, "bad_params", "Invalid field", { field: "language" });
    expect(response.status).toBe(422);
    expect(response.headers.get("x-request-id")).toMatch(/^req_/);
    expect(await response.json()).toMatchObject({
      error: "bad_params",
      message: "Invalid field",
      details: { field: "language" },
    });
  });

  test("returns a public liveness response with CORS and no redirect", async () => {
    const response = healthResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-request-id")).toMatch(/^req_/);
    expect(await response.json()).toEqual({
      ok: true,
      service: "luma-card-event-router",
      apiVersion: "v1",
    });
  });
});
