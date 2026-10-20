import assert from "node:assert/strict";
import test from "node:test";
import { serializeRebaseTodo, validateRebasePlan } from "../src/features/rebase/rebasePlan";

test("serializes a rebase todo", () => {
  const todo = serializeRebaseTodo([
    { id:"1", action:"pick", commit:"abcdef123456", subject:"first", originalIndex:0 },
    { id:"2", action:"squash", commit:"fedcba654321", subject:"second", originalIndex:1 }
  ]);
  assert.match(todo, /^pick abcdef123456 first\nsquash fedcba654321 second\n$/);
});

test("rejects squash as first action", () => {
  assert.throws(() => validateRebasePlan([
    { id:"1", action:"squash", commit:"abcdef123456", subject:"bad", originalIndex:0 }
  ]));
});
