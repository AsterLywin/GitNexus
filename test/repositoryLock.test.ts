import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryLock } from "../src/state/repositoryLock";

test("serializes repository mutations", async () => {
  const lock = new RepositoryLock();
  const release1 = await lock.acquire("one");
  let acquired = false;

  const pending = lock.acquire("two").then(release => {
    acquired = true;
    release();
  });

  await Promise.resolve();
  assert.equal(acquired, false);

  release1();
  await pending;
  assert.equal(acquired, true);
});
