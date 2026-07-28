#!/usr/bin/env node
/**
 * Pack the package, install from the tarball in a temp dir, and verify the
 * published CLI actually runs — catches the "npx: command not found" class of bugs.
 *
 * Usage: npm run test:pack
 */
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { constants } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? root,
      stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...opts.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${cmd} ${args.join(" ")} exited ${code}\n${stderr || stdout}`,
          ),
        );
    });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function expectFailure(cmd, args, opts = {}) {
  try {
    await run(cmd, args, opts);
  } catch (error) {
    return error.message;
  }
  throw new Error(`${cmd} ${args.join(" ")} unexpectedly succeeded`);
}

async function main() {
  console.log("→ build");
  await run("npm", ["run", "build"]);

  console.log("→ npm pack");
  const { stdout: packOut } = await run("npm", ["pack", "--silent"]);
  const tgzName = packOut.trim().split("\n").pop();
  assert(tgzName?.endsWith(".tgz"), `expected tarball name, got: ${packOut}`);
  const tgzPath = join(root, tgzName);

  const work = await mkdtemp(join(tmpdir(), "contractbot-pack-"));
  const fixture = join(work, "app");
  const installDir = join(work, "install");

  try {
    console.log(`→ install tarball into ${installDir}`);
    await mkdir(installDir, { recursive: true });
    await writeFile(
      join(installDir, "package.json"),
      JSON.stringify({ name: "pack-smoke", private: true }),
    );
    await run("npm", ["install", tgzPath], { cwd: installDir });

    const bin = join(installDir, "node_modules", ".bin", "contractbot");
    await access(bin, constants.X_OK);
    console.log("→ bin linked and executable");

    const { stdout: help } = await run(bin, ["--help"], { cwd: installDir });
    assert(
      help.includes("setup") && help.includes("watch"),
      `cli --help missing expected commands:\n${help}`,
    );
    console.log("→ contractbot --help ok");

    // Fixture app with a real package.json dep signal
    await mkdir(join(fixture, "src"), { recursive: true });
    await writeFile(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "fixture-app",
        dependencies: { stripe: "^14.0.0" },
      }),
    );
    await writeFile(
      join(fixture, "src", "pay.ts"),
      `import Stripe from "stripe";\nexport const s = new Stripe("sk_test");\n`,
    );

    console.log("→ setup on fixture");
    await run(bin, ["setup", "--dir", fixture], { cwd: fixture });

    const config = await readFile(join(fixture, ".contractbot.yml"), "utf-8");
    assert(config.includes("stripe"), "setup did not detect stripe");
    await access(join(fixture, ".github", "workflows", "contractbot.yml"));
    console.log("→ setup wrote config + workflow");

    // Exercise the release-critical lifecycle without depending on a live provider.
    const specPath = join(fixture, "openapi.json");
    const configPath = join(fixture, ".contractbot.yml");
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Fixture API", version: "1" },
        paths: { "/widgets": { get: { responses: { "200": { description: "OK" } } } } },
      }),
    );
    await writeFile(
      configPath,
      `apis:\n  - name: fixture-api\n    contract:\n      type: openapi\n      url: ${specPath}\n    scan_paths: []\nai:\n  provider: openai\nhealing:\n  auto_apply: none\n  output: patch\n`,
    );

    console.log("→ baseline fixture contract");
    await run(bin, ["baseline"], { cwd: fixture });
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Fixture API", version: "2" },
        paths: {},
      }),
    );

    console.log("→ detect breaking fixture change");
    const failure = await expectFailure(bin, ["ci", "--fail-on", "breaking"], { cwd: fixture });
    assert(failure.includes("fixture-api: 1 breaking"), `expected breaking CI failure, got: ${failure}`);
    await access(join(fixture, ".contractbot", "changes", "fixture-api.json"));

    console.log("→ accept fixture contract");
    await run(bin, ["accept", "fixture-api"], { cwd: fixture });
    await run(bin, ["ci", "--fail-on", "breaking"], { cwd: fixture });
    console.log("→ baseline -> change -> accept lifecycle ok");

    console.log("\n✓ pack smoke passed — release artifact lifecycle verified");
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(tgzPath, { force: true });
  }
}

main().catch((err) => {
  console.error("\n✗ pack smoke failed:", err.message);
  process.exit(1);
});
