import { describe, it, expect } from "vitest";
import { parseRecipient } from "../../src/services/parseRecipient";

describe("parseRecipient", () => {
  it("parses a basic mention and trims the message", () => {
    const result = parseRecipient("<<@USER123>>   hello there   ");
    expect(result).toEqual({ userId: "USER123", message: "hello there" });
  });

  it("returns null on a string that does not start with a mention", () => {
    expect(parseRecipient("hello <<@USER123>>")).toBeNull();
  });

  it("returns null on an empty string", () => {
    expect(parseRecipient("")).toBeNull();
  });

  it("returns an empty message if nothing follows the mention", () => {
    expect(parseRecipient("<<@USER123>>")).toEqual({
      userId: "USER123",
      message: "",
    });
  });

  it("preserves newlines inside the message body", () => {
    const result = parseRecipient("<<@U1>> line one\nline two");
    expect(result).toEqual({ userId: "U1", message: "line one\nline two" });
  });

  it("handles user IDs with hex characters", () => {
    const result = parseRecipient("<<@64ad1305c701cc5be7c26fe5>> hi");
    expect(result?.userId).toBe("64ad1305c701cc5be7c26fe5");
  });
});
