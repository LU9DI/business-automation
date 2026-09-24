import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampInt,
  cleanText,
  escapeLike,
  finiteNumber,
  ENTITY_TYPES,
  RULE_KINDS,
} from "../src/domain/sentinelValidation.js";

test("cleanText trims and bounds input", () => {
  assert.equal(cleanText("  Horus  "), "Horus");
  assert.equal(cleanText("123456", 3), "123");
});

test("clampInt rejects non-finite values and clamps ranges", () => {
  assert.equal(clampInt("10.9", 2, 1, 5), 5);
  assert.equal(clampInt("not-a-number", 2, 1, 5), 2);
  assert.equal(clampInt(-10, 2, 1, 5), 1);
});

test("escapeLike protects SQL LIKE wildcards", () => {
  assert.equal(escapeLike("100%_\\\\"), "100\\%\\_\\\\");
});

test("finiteNumber accepts finite numeric input only", () => {
  assert.equal(finiteNumber("125.50"), 125.5);
  assert.equal(finiteNumber(""), null);
  assert.equal(finiteNumber("Infinity"), null);
});

test("Horus rule and entity vocabularies remain explicit", () => {
  assert.ok(ENTITY_TYPES.includes("company"));
  assert.ok(RULE_KINDS.includes("temporal_burst"));
});
