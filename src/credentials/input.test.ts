import { describe, expect, it } from "vitest";
import { normalizePrefix, normalizeUsername, validateSecret } from "./input";

describe("normalizePrefix", () => {
  it("trims outer whitespace, lowercases the host, and preserves path case", () => {
    expect(normalizePrefix(" GHCR.IO/Team ")).toBe("ghcr.io/Team");
  });

  it("maps host casing variants to the same prefix", () => {
    expect(normalizePrefix("ghcr.io/team")).toBe(normalizePrefix("GHCR.IO/team"));
  });

  it.each(["GHCR.IO:443", "GHCR.IO:443/team"])(
    "preserves an explicitly supplied default port in %s",
    (value) => {
      expect(normalizePrefix(value)).toBe(value.toLowerCase());
    },
  );

  it.each(["https://ghcr.io/team", "ghcr.io/team/", "ghcr.io/team?x=1", "/team", "ghcr.io/a b"])(
    "rejects invalid prefix %s",
    (value) => {
      expect(() => normalizePrefix(value)).toThrow();
    },
  );
});

describe("normalizeUsername", () => {
  it("trims outer whitespace", () => {
    expect(normalizeUsername(" robot ")).toBe("robot");
  });

  it("rejects a blank username", () => {
    expect(() => normalizeUsername("  ")).toThrow();
  });
});

describe("validateSecret", () => {
  it("rejects a whitespace-only secret", () => {
    expect(() => validateSecret("  ")).toThrow();
  });

  it("preserves spaces in a nonblank secret", () => {
    expect(validateSecret(" token with spaces ")).toBe(" token with spaces ");
  });
});
