import test from "node:test";
import assert from "node:assert/strict";
import { signAccessToken, verifyAccessToken } from "../src/core/jwt.js";

test("access tokens round-trip with subject and role", () => {
  process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
  const token = signAccessToken({ sub: "user-test", role: "user" });
  const payload = verifyAccessToken(token);
  assert.equal(payload.sub, "user-test");
  assert.equal(payload.role, "user");
});

test("tokens signed with the previous secret remain verifiable during rotation", () => {
  process.env.JWT_SECRET = "current-secret-that-is-at-least-32-characters-long";
  process.env.JWT_SECRET_PREVIOUS = "previous-secret-that-is-at-least-32-characters-long";

  const token = signAccessToken({ sub: "rotation-user" });

  process.env.JWT_SECRET = "new-current-secret-that-is-at-least-32-characters-long";
  const payload = verifyAccessToken(token);
  assert.equal(payload.sub, "rotation-user");

  delete process.env.JWT_SECRET_PREVIOUS;
});
