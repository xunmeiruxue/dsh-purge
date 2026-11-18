// 破甲总开关（master switch）。
//
// 一个状态文件决定"破甲是否生效"：
//   off = 真还原：宿主补丁回退、注入正文与破甲强化段同时停用；
//   on  = 重新写回宿主补丁并恢复注入。
// 只碰状态与请求侧，不动 prompt-inject.md / 备份 / 面板，随时可以再开。
import fs from "node:fs";
import path from "node:path";

export const MASTER_STATE = "master-switch.json";

/** 每轮组装都会问一次，读盘不能成为热点：200ms 级缓存。 */
const CACHE_MS = 200;
let cache = { home: "", at: 0, off: false };

export function masterSwitchPath(dshHome) {
  const home = String(dshHome || "").trim();
  if (!home) return "";
  return path.join(home, "dsh-purge", MASTER_STATE);
}

export function readMasterSwitch(dshHome) {
  const file = masterSwitchPath(dshHome);
  if (!file) return { off: false, at: "", prevBoost: undefined, file: "" };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      off: raw?.off === true,
      at: typeof raw?.at === "string" ? raw.at : "",
      prevBoost:
        typeof raw?.prevBoost === "boolean" ? raw.prevBoost : undefined,
      file,
    };
  } catch {
    // 缺失或坏文件一律按"开"处理：开关默认不生效，绝不让坏文件把破甲卡死。
    return { off: false, at: "", prevBoost: undefined, file };
  }
}

export function writeMasterSwitch(dshHome, state = {}) {
  const file = masterSwitchPath(dshHome);
  if (!file) throw new Error("找不到 DSH 主目录，无法写入破甲开关");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = { off: state.off === true, at: new Date().toISOString() };
  if (typeof state.prevBoost === "boolean") body.prevBoost = state.prevBoost;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
  // 原子替换：半写的开关文件会让下一次启动读到坏的 JSON。
  fs.renameSync(tmp, file);
  cache = { home: String(dshHome), at: Date.now(), off: body.off };
  return readMasterSwitch(dshHome);
}

export function clearMasterSwitch(dshHome) {
  const file = masterSwitchPath(dshHome);
  if (file) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* 不存在即等于已开 */
    }
  }
  cache = { home: String(dshHome || ""), at: Date.now(), off: false };
}

export function isMasterOff(dshHome) {
  const home = String(dshHome || "").trim();
  if (!home) return false;
  const now = Date.now();
  if (cache.home === home && now - cache.at < CACHE_MS) return cache.off;
  const off = readMasterSwitch(home).off;
  cache = { home, at: now, off };
  return off;
}
