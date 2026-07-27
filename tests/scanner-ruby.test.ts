import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { scanRubyForApiUsages } from "../src/scanner/ruby.js";

const TEST_DIR = join(process.cwd(), ".test-rb-scanner-tmp");
const src = (name: string) => join(TEST_DIR, "src", name);
const pattern = () => [join(TEST_DIR, "src/**/*.rb")];

beforeEach(async () => {
  await mkdir(join(TEST_DIR, "src"), { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
});

describe("Ruby scanner — comment filtering", () => {
  it("ignores single-line comments containing API paths", async () => {
    await writeFile(
      src("commented.rb"),
      `
# HTTParty.get("https://api.example.com/v1/users")
# endpoint: /v1/users
x = 42
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });

  it("ignores =begin/=end block comments", async () => {
    await writeFile(
      src("block_comment.rb"),
      `
=begin
  Old endpoint: /v1/users
  HTTParty.get("https://api.example.com/v1/users")
=end

def main
  42
end
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });
});

describe("Ruby scanner — variable tracking", () => {
  it("tracks URL assigned to variable used in HTTP call", async () => {
    await writeFile(
      src("var_track.rb"),
      `
require 'httparty'

url = "https://api.example.com/v1/users"
response = HTTParty.get(url)
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
    const httpCall = usages.find((u) => u.snippet.includes("HTTParty.get"));
    expect(httpCall).toBeDefined();
  });

  it("tracks instance variable assignments", async () => {
    await writeFile(
      src("instance_var.rb"),
      `
class ApiClient
  def initialize
    @base_url = "https://api.example.com/v1/orders"
  end

  def fetch_orders
    RestClient.get(@base_url)
  end
end
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/orders"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  it("tracks CONSTANT assignments", async () => {
    await writeFile(
      src("constants.rb"),
      `
BASE_URL = "https://api.example.com/v1/users"

def get_users
  Faraday.get(BASE_URL)
end
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Ruby scanner — string interpolation", () => {
  it("detects string interpolation with tracked variable", async () => {
    await writeFile(
      src("interpolation.rb"),
      `
base = "https://api.example.com/v1/users"
user_id = 123
url = "#{base}/#{user_id}/profile"
HTTParty.get(url)
`,
      "utf-8",
    );

    // The base variable contains the path, and is referenced in interpolation
    const usages = await scanRubyForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Ruby scanner — wrapper detection", () => {
  it("detects @client wrapper calls", async () => {
    await writeFile(
      src("client_wrapper.rb"),
      `
class Service
  def get_users
    @client.get("https://api.example.com/v1/users")
  end
end
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0].methodHint).toBe("GET");
  });

  it("detects api_client wrapper", async () => {
    await writeFile(
      src("api_client.rb"),
      `
response = api_client.post("https://api.example.com/v1/orders", body: data)
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/orders"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0].methodHint).toBe("POST");
  });

  it("detects self.get wrapper in module", async () => {
    await writeFile(
      src("self_wrapper.rb"),
      `
module UsersApi
  def self.get_all
    self.get("https://api.example.com/v1/users")
  end
end
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Ruby scanner — false positive reduction", () => {
  it("does not match URLs only in comments", async () => {
    await writeFile(
      src("only_comments.rb"),
      `
# Old API: /v1/users
# HTTParty.get("https://api.example.com/v1/users")

=begin
Another reference to /v1/users
=end

def unrelated
  42
end
`,
      "utf-8",
    );

    const usages = await scanRubyForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });
});
