import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkUpstream,
  compareVersions,
  isBehind,
  normalizeVersion,
  readUpstreamCache,
  upstreamCachePath,
  writeUpstreamCache,
} from "../lib/upstream-watch.js";

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "purge-upstream-"));

test("version parsing and ordering", () => {
  assert.equal(normalizeVersion("v1.7.20"), "1.7.20");
  assert.equal(normalizeVersion(" 1.7.20 "), "1.7.20");
  assert.equal(compareVersions("1.7.9", "1.7.20"), -1);
  assert.equal(compareVersions("v1.7.20", "1.7.20"), 0);
  assert.equal(compareVersions("1.7.20", "1.7.20-rc.1"), 1);
  assert.equal(compareVersions("1.8.0", "1.7.99"), 1);
  assert.equal(isBehind("1.7.20", "1.7.21"), true);
  assert.equal(isBehind("1.7.20", "1.7.20"), false);
  assert.equal(isBehind("1.7.20", ""), false);
});

test("cache round-trips and tolerates a broken file", () => {
  const dir = home();
  try {
    assert.equal(readUpstreamCache(dir).version, "");
    writeUpstreamCache(dir, { version: "1.7.21", url: "https://example/x", checkedAt: 123 });
    const cached = readUpstreamCache(dir);
    assert.equal(cached.version, "1.7.21");
    assert.equal(cached.checkedAt, 123);
    fs.mkdirSync(path.join(dir, "dsh-purge"), { recursive: true });
    fs.writeFileSync(upstreamCachePath(dir), "{oops", "utf8");
    assert.equal(readUpstreamCache(dir).version, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("check reuses the cache inside the TTL and refetches when forced", async () => {
  const dir = home();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { tag_name: "v1.7.25", html_url: "https://github.com/x/releases/tag/v1.7.25" };
  };
  try {
    const first = await checkUpstream({ dshHome: dir, fetcher, now: () => 1000 });
    assert.equal(first.version, "1.7.25");
    assert.equal(first.fromCache, false);
    assert.equal(calls, 1);
    const again = await checkUpstream({ dshHome: dir, fetcher, now: () => 2000 });
    assert.equal(again.fromCache, true);
    assert.equal(calls, 1);
    await checkUpstream({ dshHome: dir, fetcher, force: true, now: () => 3000 });
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed fetch keeps the last known version and reports the error", async () => {
  const dir = home();
  try {
    writeUpstreamCache(dir, { version: "1.7.24", url: "u", checkedAt: 1 });
    const out = await checkUpstream({
      dshHome: dir,
      force: true,
      fetcher: async () => {
        throw new Error("offline");
      },
      now: () => 100,
    });
    assert.equal(out.version, "1.7.24");
    assert.equal(out.error, "offline");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
