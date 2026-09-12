import { JwtService } from "@nestjs/jwt";
import { describe, expect, it } from "vitest";

const secret = "test-access-secret-with-at-least-32-characters";
const jwt = new JwtService();

describe("JWT verification security", () => {
  it("accepts an unexpired HS256 token with the configured signature", () => {
    const token = jwt.sign({ sub: "student", accountType: "STUDENT" }, { secret, algorithm: "HS256", expiresIn: "5m" });
    expect(jwt.verify(token, { secret, algorithms: ["HS256"] }).sub).toBe("student");
  });

  it("rejects an invalid signature", () => {
    const token = jwt.sign({ sub: "student" }, { secret: "different-secret-with-at-least-32-characters", algorithm: "HS256", expiresIn: "5m" });
    expect(() => jwt.verify(token, { secret, algorithms: ["HS256"] })).toThrow();
  });

  it("rejects expired and malformed tokens", () => {
    const expired = jwt.sign({ sub: "student" }, { secret, algorithm: "HS256", expiresIn: -1 });
    expect(() => jwt.verify(expired, { secret, algorithms: ["HS256"] })).toThrow();
    expect(() => jwt.verify("not-a-jwt", { secret, algorithms: ["HS256"] })).toThrow();
  });
});
