// 本 fork 追加能力的集中实现：破甲总开关 + 上游只读提示。
// 刻意集中在这里，让 lib/index.js 只留两三行接线——上游每次发版都会动 index.js，
// 接线越短，自动同步时越不可能冲突。
import * as core from "./core.js";
import { readBoost, writeBoost } from "./boost.js";
import {
  clearMasterSwitch,
  readMasterSwitch,
  writeMasterSwitch,
} from "./master-switch.js";
import * as updater from "./update.js";

/** POST /dsh-purge/master  {off:boolean} —— 总开关：关=真还原，开=恢复注入并等 Apply。 */
export function makeMasterHandler({ sendJson, readJsonBody, refreshHungOperator, purgeLog = () => {} }) {
  return async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" });
      response.end();
      return;
    }
    try {
      const body = await readJsonBody(request);
      const home = core.findDshHome();
      if (!home) {
        sendJson(response, 500, { ok: false, error: "找不到 DSH 主目录" });
        return;
      }
      // 默认按"关"处理：只有显式 {off:false} 才是打开。
      const off = body?.off !== false;
      if (off) {
        const prevBoost = readBoost(home);
        writeMasterSwitch(home, { off: true, prevBoost });
        try { writeBoost(false, home); } catch { /* 强化段非关键 */ }
        let reverted = 0;
        let errors = 0;
        try {
          const state = await core.gatherState();
          if (state.ai_base) {
            const r = await core.revertAll(state.ai_base);
            reverted = r.reverted.length;
            errors = r.errors.length;
          }
        } catch (e) {
          errors += 1;
          purgeLog("master.revert_err", { err: String((e && e.message) || e) });
        }
        let shim = null;
        try { shim = await core.revertAllShims(); } catch { /* shim 非关键 */ }
        try { core.hangOperatorPrompt(""); } catch { /* ignore */ }
        try { refreshHungOperator(home); } catch { /* ignore */ }
        sendJson(response, 200, {
          ok: true,
          off: true,
          reverted,
          errors,
          shim,
          restart_required: true,
          prev_boost: prevBoost,
          note: "已回退宿主补丁并停用注入与强化段；完全退出并重开 DSH 后为原版。",
        });
        return;
      }
      const prev = readMasterSwitch(home);
      clearMasterSwitch(home);
      if (prev.prevBoost === true) {
        try { writeBoost(true, home); } catch { /* ignore */ }
      }
      sendJson(response, 200, {
        ok: true,
        off: false,
        restart_required: true,
        need_apply: true,
        restored_boost: prev.prevBoost === true,
      });
    } catch (e) {
      sendJson(response, 500, { ok: false, error: String(e) });
    }
  };
}

/** /purge master on|off|status —— CLI 侧的总开关，逻辑与 HTTP 路由一致。 */
export async function runMasterCommand(args = []) {
  const home = core.findDshHome();
  if (!home) return { kind: "error", text: "找不到 DSH 主目录" };
  const want = String(args[1] || "status").toLowerCase();
  const now = readMasterSwitch(home);
  if (want === "status" || want === "st") {
    return {
      kind: "success",
      text: now.off
        ? "破甲总开关：已关闭（真还原：宿主补丁已回退、注入与强化段停用）"
        : "破甲总开关：已开启",
    };
  }
  if (want !== "off" && want !== "on") {
    return { kind: "error", text: "用法：/purge master on|off|status" };
  }
  if (want === "off") {
    const prevBoost = readBoost(home);
    writeMasterSwitch(home, { off: true, prevBoost });
    try { writeBoost(false, home); } catch { /* 强化段非关键 */ }
    const state = await core.gatherState();
    const lines = [];
    if (state.ai_base) {
      const { reverted, errors } = await core.revertAll(state.ai_base);
      lines.push("  已还原 " + reverted.length + " 个宿主文件" + (errors.length ? "，" + errors.length + " 个失败" : ""));
    } else {
      lines.push("  没有定位到宿主，跳过补丁回退");
    }
    try { await core.revertAllShims(); } catch { /* shim 非关键 */ }
    try { core.hangOperatorPrompt(""); } catch { /* ignore */ }
    lines.push("", "破甲已关闭：注入与强化段停用、宿主补丁已回退。完全退出并重开 dsh 后为原版。");
    return { kind: "success", text: lines.join("\n") };
  }
  const prev = readMasterSwitch(home);
  clearMasterSwitch(home);
  if (prev.prevBoost === true) { try { writeBoost(true, home); } catch { /* ignore */ } }
  return { kind: "success", text: "破甲总开关已打开：再执行 /purge apply 把补丁写回宿主，然后重开 dsh。" };
}

/** purge_master 工具：让 agent 也能切总开关。 */
export function registerForkTools(tools, log = () => {}) {
  if (!tools || typeof tools.register !== "function") return;
  tools.register({
    name: "purge_master",
    description: "破甲总开关：off 打开真还原（回退全部宿主补丁、停用提示词注入与破甲强化段，请求里不再有破甲内容）；on 恢复注入并可在随后 Apply 写回宿主。不改 prompt-inject.md、备份与面板，两种状态都要重启 dsh 才生效。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        off: { type: "boolean", description: "true=关闭破甲并回退补丁；false=重新打开" },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" } },
      },
      render: (_args, value) => [{ type: "text", text: String(value?.text ?? "") }],
    },
    async execute(args) {
      const home = core.findDshHome();
      if (!home) return { text: "找不到 DSH 主目录" };
      const off = args?.off !== false;
      try {
        if (off) {
          const prevBoost = readBoost(home);
          writeMasterSwitch(home, { off: true, prevBoost });
          try { writeBoost(false, home); } catch { /* ignore */ }
          const state = await core.gatherState();
          let reverted = 0;
          if (state.ai_base) {
            const r = await core.revertAll(state.ai_base);
            reverted = r.reverted.length;
          }
          try { await core.revertAllShims(); } catch { /* ignore */ }
          try { core.hangOperatorPrompt(""); } catch { /* ignore */ }
          return { text: "master=off reverted=" + reverted + ". 注入与强化段已停用；重启 dsh 后为原版." };
        }
        const prev = readMasterSwitch(home);
        clearMasterSwitch(home);
        if (prev.prevBoost === true) { try { writeBoost(true, home); } catch { /* ignore */ } }
        return { text: "master=on. 再执行 purge_apply 或点「应用」写回宿主，然后重启 dsh." };
      } catch (e) {
        log("fork tool error:", String((e && e.message) || e));
        return { text: "切换失败：" + String((e && e.message) || e) };
      }
    },
  });
}
