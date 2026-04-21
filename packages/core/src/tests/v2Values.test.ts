import { gzipSync } from "zlib";
import { decodeV2Values, encodeV2Values } from "../flowDesigner/values";

describe("decodeV2Values / encodeV2Values", () => {
  describe("round-trip", () => {
    it("decodes what encodeV2Values encoded (primitive array)", () => {
      const original = [
        { actionInstanceSysId: "abc", id: "1", name: "to", value: "user@example.com" },
        { actionInstanceSysId: "abc", id: "2", name: "subject", value: "hi" },
      ];
      const blob = encodeV2Values(original);
      expect(decodeV2Values(blob)).toEqual(original);
    });

    it("decodes what encodeV2Values encoded (nested parameter objects)", () => {
      const original = [
        {
          actionInstanceSysId: "abc123",
          id: "input_a",
          name: "record",
          value: { table: "incident", sys_id: "xyz" },
          parameter: {
            type: "reference",
            labels: { en: "Record" },
            validation: { mandatory: true },
          },
        },
      ];
      const blob = encodeV2Values(original);
      expect(decodeV2Values(blob)).toEqual(original);
    });

    it("handles empty array", () => {
      expect(decodeV2Values(encodeV2Values([]))).toEqual([]);
    });

    it("handles large payloads without truncation", () => {
      const big = Array.from({ length: 500 }, (_, i) => ({
        id: String(i),
        name: "field_" + i,
        value: "x".repeat(200),
      }));
      expect(decodeV2Values(encodeV2Values(big))).toEqual(big);
    });
  });

  describe("decode — input validation", () => {
    it("throws on empty string", () => {
      expect(() => decodeV2Values("")).toThrow(/non-empty string/);
    });

    it("throws on whitespace-only string", () => {
      expect(() => decodeV2Values("   \n  ")).toThrow(/non-empty string/);
    });

    it("throws on non-string input", () => {
      expect(() => decodeV2Values(null as unknown as string)).toThrow(/non-empty string/);
      expect(() => decodeV2Values(undefined as unknown as string)).toThrow(/non-empty string/);
      expect(() => decodeV2Values(123 as unknown as string)).toThrow(/non-empty string/);
    });

    it("throws with a clear message on non-gzip base64 input", () => {
      // Valid base64, but the decoded bytes are not gzip.
      const notGzip = Buffer.from("hello world").toString("base64");
      expect(() => decodeV2Values(notGzip)).toThrow(/decompression failed/);
    });

    it("throws on gzip of invalid JSON", () => {
      const badJson = gzipSync(Buffer.from("{not valid json", "utf8")).toString("base64");
      expect(() => decodeV2Values(badJson)).toThrow(/not valid JSON/);
    });

    it("tolerates trailing whitespace and newlines (common from file reads)", () => {
      const blob = encodeV2Values([{ id: "1", value: "a" }]);
      expect(decodeV2Values(blob + "\n")).toEqual([{ id: "1", value: "a" }]);
      expect(decodeV2Values("  " + blob + "  ")).toEqual([{ id: "1", value: "a" }]);
    });
  });

  describe("generic typing", () => {
    it("preserves the caller's expected type", () => {
      interface Foo {
        actionInstanceSysId: string;
        id: string;
      }
      const blob = encodeV2Values([{ actionInstanceSysId: "a", id: "1" }]);
      const decoded = decodeV2Values<Foo[]>(blob);
      expect(decoded[0].actionInstanceSysId).toBe("a");
      expect(decoded[0].id).toBe("1");
    });
  });
});
