import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearMasterSwitch,
  isMasterOff,
  masterSwitchPath,
  readMasterSwitch,
  writeMasterSwitch,
} from "../lib/master-switch.js";
import { injectionPolicy } from "../lib/preset-injection.js";

const ctxFor = (preset) => ({ agent: { session: { header: { agentPreset: preset } } } });
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "purge-master-"));

test("master switch defaults to on and tolerates a broken file", () => {
  const dir = home();
  try {
    assert.equal(isMasterOff(dir), false);
    assert.equal(readMasterSwitch(dir).off, false);
    fs.mkdirSync(path.join(dir, "dsh-purge"), { recursive: true });
    fs.writeFileSync(masterSwitchPath(dir), "{not json", "utf8");
    assert.equal(isMasterOff(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("off round-trips and remembers the boost preference", () => {
  const dir = home();
  try {
    writeMasterSwitch(dir, { off: true, prevBoost: true });
    const state = readMasterSwitch(dir);
    assert.equal(state.off, true);
    assert.equal(state.prevBoost, true);
    assert.equal(isMasterOff(dir), true);
    clearMasterSwitch(dir);
    assert.equal(isMasterOff(dir), false);
    assert.equal(fs.existsSync(masterSwitchPath(dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("master off beats every preset allowance", () => {
  const config = { enabled: true, excludePresets: [] };
  for (const preset of ["standard", "minimal", "unrestricted", ""]) {
    assert.equal(injectionPolicy(config, ctxFor(preset)).allowed, true);
    const off = injectionPolicy(config, ctxFor(preset), true);
    assert.equal(off.allowed, false);
    assert.equal(off.masterOff, true);
  }
  // 关着的时候，excludePresets 的"未知上下文"判定并不会把开关重新打开。
  assert.equal(injectionPolicy({ enabled: true, excludePresets: ["roleplay"] }, {}, true).allowed, false);
});

test("config.enabled still wins when the switch is on", () => {
  assert.equal(injectionPolicy({ enabled: false }, ctxFor("standard"), false).allowed, false);
  assert.equal(injectionPolicy({ enabled: false }, ctxFor("standard"), true).allowed, false);
});
