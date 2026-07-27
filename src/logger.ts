import { writeFile, appendFile, mkdir } from "fs/promises";
import { dirname } from "path";
import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type OutputFormat = "human" | "json";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_ICON: Record<LogLevel, string> = {
  debug: chalk.dim("⋯"),
  info: chalk.blue("ℹ"),
  warn: chalk.yellow("⚠"),
  error: chalk.red("✗"),
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: OutputFormat;
  logFile?: string;
  silent?: boolean;
}

class Logger {
  private level: LogLevel = "info";
  private format: OutputFormat = "human";
  private logFile: string | null = null;
  private silent = false;
  private fileInitialized = false;
  private entries: LogEntry[] = [];

  configure(options: LoggerOptions): void {
    if (options.level) this.level = options.level;
    if (options.format) this.format = options.format;
    if (options.logFile !== undefined) this.logFile = options.logFile;
    if (options.silent !== undefined) this.silent = options.silent;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  getFormat(): OutputFormat {
    return this.format;
  }

  isJsonMode(): boolean {
    return this.format === "json";
  }

  /**
   * Returns all log entries captured in this session.
   * Useful for programmatic access / testing.
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  reset(): void {
    this.entries = [];
    this.level = "info";
    this.format = "human";
    this.logFile = null;
    this.silent = false;
    this.fileInitialized = false;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  /**
   * Outputs structured data. In JSON mode, emits the object directly.
   * In human mode, formats it as indented key-value pairs.
   */
  data(label: string, payload: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: label,
      context: payload,
    };
    this.entries.push(entry);

    if (!this.shouldOutput("info")) return;

    if (this.format === "json") {
      this.writeStdout(JSON.stringify({ type: "data", label, ...payload }));
    } else {
      this.writeStdout(chalk.bold(label));
      for (const [key, value] of Object.entries(payload)) {
        const formatted = typeof value === "object" ? JSON.stringify(value) : String(value);
        this.writeStdout(chalk.dim(`  ${key}: `) + formatted);
      }
    }

    this.writeToFile(entry);
  }

  /**
   * Outputs a result object. In JSON mode, emits as { type: "result", ... }.
   * In human mode, falls through to the caller's display logic.
   */
  result(payload: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: "result",
      context: payload,
    };
    this.entries.push(entry);

    if (this.format === "json") {
      this.writeStdout(JSON.stringify({ type: "result", ...payload }));
    }

    this.writeToFile(entry);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };
    this.entries.push(entry);

    if (this.shouldOutput(level)) {
      if (this.format === "json") {
        this.writeStdout(JSON.stringify(entry));
      } else {
        const icon = LEVEL_ICON[level];
        const contextStr = context
          ? chalk.dim(` ${JSON.stringify(context)}`)
          : "";
        this.writeStdout(`${icon} ${message}${contextStr}`);
      }
    }

    this.writeToFile(entry);
  }

  private shouldOutput(level: LogLevel): boolean {
    if (this.silent) return false;
    return LEVEL_RANK[level] >= LEVEL_RANK[this.level];
  }

  private writeStdout(line: string): void {
    console.log(line);
  }

  private writeToFile(entry: LogEntry): void {
    if (!this.logFile) return;

    const line = JSON.stringify(entry) + "\n";

    if (!this.fileInitialized) {
      this.fileInitialized = true;
      const dir = dirname(this.logFile);
      mkdir(dir, { recursive: true })
        .then(() => writeFile(this.logFile!, line, "utf-8"))
        .catch(() => {});
    } else {
      appendFile(this.logFile, line, "utf-8").catch(() => {});
    }
  }
}

/** Singleton logger instance shared across the application. */
export const logger = new Logger();
