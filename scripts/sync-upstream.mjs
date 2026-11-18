#!/usr/bin/env node
/**
 * 把上游合并进这个 fork。
 *
 * 只自动解决一类冲突：构建产物 client.js（每次都变，手合没有意义）。
 * 其余冲突（源码 / 文档）一律停下并保留现场，由人判断——脚本不会悄悄丢掉你的改动。
 *
 * 用法：
 *   node scripts/sync-upstream.mjs             # 合并 + 重建 + 校验 + 提交
 *   node scripts/sync-upstream.mjs --push      # 校验通过后顺带 push
 *   node scripts/sync-upstream.mjs --dry-run   # 只看上游有多少新提交
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM_URL = "https://github.com/kingcharleslzy-ai/dsh-purge.git";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const PUSH = flags.has("--push");
const DRY = flags.has("--dry-run");
const GENERATED = new Set(["client.js"]);

const say = (msg) => process.stdout.write(msg + "\n");
const fail = (msg) => {
  process.stderr.write("✗ " + msg + "\n");
  process.exit(1);
};

function git(args, { allowFail = false, capture = false } = {}) {
  const res = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (res.status !== 0 && !allowFail) fail("git " + args.join(" ") + " 失败");
  return res;
}

function npm(args) {
  const res = spawnSync("npm", args, { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
  if (res.status !== 0) fail("npm " + args.join(" ") + " 失败");
}

// 1) 工作区必须干净：合并到一半的仓库不能叠加第二次操作
const dirty = git(["status", "--porcelain"], { capture: true }).stdout.trim();
if (dirty) fail("工作区有未提交改动，先提交或 stash 再同步：\n" + dirty);

// 2) upstream remote
const hasUpstream = git(["remote", "get-url", "upstream"], { allowFail: true, capture: true }).status === 0;
if (!hasUpstream) git(["remote", "add", "upstream", UPSTREAM_URL]);
git(["fetch", "upstream", "master", "--prune"]);

const behind = git(["rev-list", "--count", "HEAD..upstream/master"], { capture: true }).stdout.trim();
say("上游新增提交：" + behind);
if (DRY) process.exit(0);
if (behind === "0") {
  say("上游没有新提交，仍然重建一次产物以确认一致。");
}

// 3) 三路合并，先不提交
const merge = git(["merge", "--no-commit", "--no-ff", "upstream/master"], { allowFail: true });

// 4) 冲突处理
const conflicted = git(["diff", "--name-only", "--diff-filter=U"], { capture: true })
  .stdout.split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

if (conflicted.length) {
  const unexpected = conflicted.filter((f) => !GENERATED.has(f));
  if (unexpected.length) {
    say("冲突不在构建产物里，保留现场退出手动处理：");
    for (const f of unexpected) say("  · " + f);
    git(["merge", "--abort"], { allowFail: true });
    fail("已 abort，仓库回到同步前的状态。");
  }
  say("只冲突在 client.js：取上游那份，稍后用源码重建。");
  git(["checkout", "--theirs", "client.js"]);
  git(["add", "client.js"]);
}

// 5) 重建产物（esbuild 是本仓库 devDependency，只装本机/CI，不入库）
if (!fs.existsSync(path.join(ROOT, "node_modules", "esbuild"))) {
  say("安装 esbuild（构建 client.js 用，node_modules 已被 git 忽略）");
  npm(["i", "--no-save", "--no-audit", "--no-fund", "esbuild@0.28.2"]);
}
const build = spawnSync("node", ["packages/purge-panel/scripts/build.mjs", "--community"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (build.status !== 0) fail("构建失败，合并保留未提交状态，请检查后处理。");

// 6) 校验：产物与源码一致、文档版本一致、fork 自己的单测
for (const args of [
  ["packages/purge-panel/scripts/build.mjs", "--community", "--check"],
  ["scripts/check-docs.mjs"],
  ["--test", "test/master-switch.test.mjs", "test/upstream-watch.test.mjs"],
]) {
  const res = spawnSync("node", args, { cwd: ROOT, stdio: "inherit" });
  if (res.status !== 0) fail("校验失败：" + args.join(" "));
}

// 7) 提交（合并进行中就沿用 MERGE_MSG）
git(["add", "-A"]);
const staged = git(["diff", "--cached", "--name-only"], { capture: true }).stdout.trim();
if (!staged) {
  say("没有需要提交的改动。");
  process.exit(0);
}
const commitArgs = ["-c", "user.name=purge-sync-bot", "-c", "user.email=purge-sync-bot@users.noreply.github.com"];
if (merge.status === 0) {
  git([...commitArgs, "commit", "--no-edit"]);
} else {
  git([...commitArgs, "commit", "-m", "chore: sync upstream"]);
}
if (PUSH) git(["push", "origin", "HEAD:master"]);
say(PUSH ? "已同步并推送。" : "已同步（未推送，加 --push 才会推）。");
