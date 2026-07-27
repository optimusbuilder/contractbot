import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../src/logger.js";
import { rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TEST_LOG_DIR = join(process.cwd(), ".test-logger-tmp");
const TEST_LOG_FILE = join(TEST_LOG_DIR, "test.log");

beforeEach(() => {
  logger.reset();
});

afterEach(async () => {
  logger.reset();
  if (existsSync(TEST_LOG_DIR)) {
    await rm(TEST_LOG_DIR, { recursive: true });
  }
});

describe("Logger — level filtering", () => {
  it("captures all entries regardless of level filter", () => {
    logger.configure({ level: "error", silent: true });
    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    const entries = logger.getEntries();
    expect(entries).toHaveLength(4);
  });

  it("defaults to info level", () => {
    expect(logger.getLevel()).toBe("info");
  });

  it("changes level via configure", () => {
    logger.configure({ level: "debug" });
    expect(logger.getLevel()).toBe("debug");
  });
});

describe("Logger — output format", () => {
  it("defaults to human format", () => {
    expect(logger.getFormat()).toBe("human");
    expect(logger.isJsonMode()).toBe(false);
  });

  it("switches to json format", () => {
    logger.configure({ format: "json" });
    expect(logger.isJsonMode()).toBe(true);
  });

  it("outputs valid JSON in json mode", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.configure({ format: "json" });

    logger.info("test message", { key: "value" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.context.key).toBe("value");
    expect(parsed.timestamp).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("outputs human-readable format with icons", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.configure({ format: "human" });

    logger.warn("something happened");

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("something happened");

    consoleSpy.mockRestore();
  });
});

describe("Logger — silent mode", () => {
  it("suppresses stdout when silent", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.configure({ silent: true });

    logger.info("should not print");
    logger.error("should not print either");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("still captures entries when silent", () => {
    logger.configure({ silent: true });
    logger.info("captured");

    expect(logger.getEntries()).toHaveLength(1);
    expect(logger.getEntries()[0].message).toBe("captured");
  });
});

describe("Logger — structured data", () => {
  it("emits data as JSON object in json mode", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.configure({ format: "json" });

    logger.data("AI Usage", { requests: 3, cost: 0.004 });

    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("data");
    expect(parsed.label).toBe("AI Usage");
    expect(parsed.requests).toBe(3);
    expect(parsed.cost).toBe(0.004);

    consoleSpy.mockRestore();
  });

  it("emits data as key-value pairs in human mode", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.configure({ format: "human" });

    logger.data("Stats", { total: 5 });

    expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    consoleSpy.mockRestore();
  });
});

describe("Logger — result output", () => {
  it("emits result in json mode", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.configure({ format: "json" });

    logger.result({ api: "test", patches: 3 });

    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("result");
    expect(parsed.api).toBe("test");
    expect(parsed.patches).toBe(3);

    consoleSpy.mockRestore();
  });

  it("does not emit result to stdout in human mode", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.configure({ format: "human" });

    logger.result({ api: "test", patches: 3 });

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("still captures result entries in human mode", () => {
    logger.configure({ format: "human", silent: true });
    logger.result({ api: "test" });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].context?.api).toBe("test");
  });
});

describe("Logger — file output", () => {
  it("writes structured JSON to log file", async () => {
    logger.configure({ logFile: TEST_LOG_FILE, silent: true });

    logger.info("file test", { key: "val" });
    logger.warn("warning test");

    // File writes are async/fire-and-forget, give them time
    await new Promise((r) => setTimeout(r, 200));

    expect(existsSync(TEST_LOG_FILE)).toBe(true);
    const content = await readFile(TEST_LOG_FILE, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const first = JSON.parse(lines[0]);
    expect(first.level).toBe("info");
    expect(first.message).toBe("file test");
  });
});

describe("Logger — context", () => {
  it("includes context in entries", () => {
    logger.configure({ silent: true });
    logger.info("with context", { api: "stripe", count: 5 });

    const entry = logger.getEntries()[0];
    expect(entry.context?.api).toBe("stripe");
    expect(entry.context?.count).toBe(5);
  });

  it("handles entries without context", () => {
    logger.configure({ silent: true });
    logger.info("no context");

    const entry = logger.getEntries()[0];
    expect(entry.context).toBeUndefined();
  });
});

describe("Logger — reset", () => {
  it("clears all state", () => {
    logger.configure({ level: "debug", format: "json", silent: true });
    logger.info("before reset");

    logger.reset();

    expect(logger.getLevel()).toBe("info");
    expect(logger.getFormat()).toBe("human");
    expect(logger.isJsonMode()).toBe(false);
    expect(logger.getEntries()).toHaveLength(0);
  });
});
