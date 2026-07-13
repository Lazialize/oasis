import { describe, expect, test } from "bun:test";
import type { Connection } from "vscode-languageserver";
import { runSafely } from "../src/connection.ts";

/** Minimal fake `Connection` that only implements what `runSafely` touches
 * (`connection.console.error`), recording every call for assertions. */
function fakeConnection(): { connection: Connection; errors: string[] } {
  const errors: string[] = [];
  const connection = {
    console: { error: (message: string) => errors.push(message) },
  } as unknown as Connection;
  return { connection, errors };
}

describe("runSafely", () => {
  test("logs and swallows a rejected promise instead of throwing", async () => {
    const { connection, errors } = fakeConnection();

    runSafely(connection, "someTask", () => Promise.reject(new Error("boom")));

    // Let the microtask/timer queue drain so the `.catch` handler runs.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("someTask");
    expect(errors[0]).toContain("boom");
  });

  test("logs and swallows a synchronous throw inside the task, not just an async rejection", async () => {
    const { connection, errors } = fakeConnection();

    // A handler that throws synchronously before ever returning a promise (e.g. `uriToPath`
    // rejecting a malformed URI) must still be caught, not escape `runSafely` itself.
    expect(() =>
      runSafely(connection, "syncTask", () => {
        throw new Error("sync boom");
      }),
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("syncTask");
    expect(errors[0]).toContain("sync boom");
  });

  test("does not log anything when the task resolves normally", async () => {
    const { connection, errors } = fakeConnection();

    runSafely(connection, "okTask", () => Promise.resolve());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errors).toHaveLength(0);
  });

  test("a real unhandledRejection listener never fires for a task run through runSafely", async () => {
    let unhandled = false;
    const listener = () => {
      unhandled = true;
    };
    process.on("unhandledRejection", listener);
    try {
      const { connection } = fakeConnection();
      runSafely(connection, "task", () => Promise.reject(new Error("boom")));
      // Give Node/Bun a full tick to detect an unhandled rejection, were there one.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toBe(false);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
});
