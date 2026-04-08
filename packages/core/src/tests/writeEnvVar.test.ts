import fs from "fs";
import path from "path";
import os from "os";
import { writeEnvVar, writeEnvVars } from "../FileUtils";

describe("writeEnvVar", function () {
  let tmpDir: string;
  let envPath: string;

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinc-test-"));
    envPath = path.join(tmpDir, ".env");
  });

  afterEach(function () {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch (e) {
      // cleanup best-effort
    }
  });

  it("creates a new .env file from scratch", function () {
    writeEnvVar({ key: "FOO", value: "bar", envPath });
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toBe("FOO=bar\n");
  });

  it("replaces an existing key", function () {
    fs.writeFileSync(envPath, "FOO=old\nBAR=keep\n", "utf8");
    writeEnvVar({ key: "FOO", value: "new", envPath });
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toContain("FOO=new");
    expect(content).toContain("BAR=keep");
    expect(content).not.toContain("FOO=old");
  });

  it("appends a new key without clobbering existing ones", function () {
    fs.writeFileSync(envPath, "EXISTING=value\n", "utf8");
    writeEnvVar({ key: "NEW_KEY", value: "new_value", envPath });
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toContain("EXISTING=value");
    expect(content).toContain("NEW_KEY=new_value");
  });

  it("handles file with no trailing newline", function () {
    fs.writeFileSync(envPath, "A=1", "utf8");
    writeEnvVar({ key: "B", value: "2", envPath });
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toContain("A=1");
    expect(content).toContain("B=2");
    // Should not produce "A=1B=2" on one line
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("handles keys with regex metacharacters", function () {
    fs.writeFileSync(envPath, "MY.KEY[0]=old\n", "utf8");
    writeEnvVar({ key: "MY.KEY[0]", value: "new", envPath });
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toContain("MY.KEY[0]=new");
    expect(content).not.toContain("MY.KEY[0]=old");
    // Should not have duplicates
    const matches = content.match(/MY\.KEY\[0\]/g);
    expect(matches).toHaveLength(1);
  });
});

describe("writeEnvVars", function () {
  let tmpDir: string;
  let envPath: string;

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinc-test-"));
    envPath = path.join(tmpDir, ".env");
  });

  afterEach(function () {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch (e) {
      // cleanup best-effort
    }
  });

  it("writes multiple vars in a single call", function () {
    writeEnvVars({
      vars: [
        { key: "A", value: "1" },
        { key: "B", value: "2" },
        { key: "C", value: "3" },
      ],
      envPath,
    });
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toContain("A=1");
    expect(content).toContain("B=2");
    expect(content).toContain("C=3");
  });

  it("merges into existing file preserving unrelated keys", function () {
    fs.writeFileSync(envPath, "KEEP=yes\nUPDATE=old\n", "utf8");
    writeEnvVars({
      vars: [
        { key: "UPDATE", value: "new" },
        { key: "ADDED", value: "fresh" },
      ],
      envPath,
    });
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toContain("KEEP=yes");
    expect(content).toContain("UPDATE=new");
    expect(content).toContain("ADDED=fresh");
    expect(content).not.toContain("UPDATE=old");
  });

  it("handles empty file", function () {
    fs.writeFileSync(envPath, "", "utf8");
    writeEnvVars({
      vars: [{ key: "X", value: "y" }],
      envPath,
    });
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toBe("X=y\n");
  });
});
