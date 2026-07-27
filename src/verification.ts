import { exec } from "child_process";

export interface VerificationConfig {
  command: string;
  timeout_ms?: number;
}

export interface VerificationResult {
  command: string;
  passed: boolean;
  output?: string;
}

export function runVerification(config: VerificationConfig): Promise<VerificationResult> {
  return new Promise((resolve) => {
    exec(
      config.command,
      {
        timeout: config.timeout_ms ?? 120000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim().slice(-3000);
        resolve({
          command: config.command,
          passed: !error,
          output: output || undefined,
        });
      },
    );
  });
}
