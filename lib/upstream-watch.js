// 上游参考版本：只读 GitHub Releases，给面板一行"上游有新版"的提示。
// 它绝不参与安装流程——装什么包、升不升级，仍由你自己决定。
import fs from "node:fs";
import path from "node:path";

export const UPSTREAM_REPOSITORY = "kingcharleslzy-ai/dsh-purge";
export const UPSTREAM_CACHE = "upstream-check.json";
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export function upstreamCachePath(dshHome) {
  const home = String(dshHome || "").trim();
  if (!home) return "";
  return path.join(home, "dsh-purge", UPSTREAM_CACHE);
}

export function readUpstreamCache(dshHome) {
  const file = upstreamCachePath(dshHome);
  if (!file) return { version: "", url: "", checkedAt: 0, error: "" };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: typeof raw?.version === "string" ? raw.version : "",
      url: typeof raw?.url === "string" ? raw.url : "",
      checkedAt: Number.isFinite(raw?.checkedAt) ? raw.checkedAt : 0,
      error: typeof raw?.error === "string" ? raw.error : "",
    };
  } catch {
    return { version: "", url: "", checkedAt: 0, error: "" };
  }
}

export function writeUpstreamCache(dshHome, value = {}) {
  const file = upstreamCachePath(dshHome);
  if (!file) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = {
    version: typeof value.version === "string" ? value.version : "",
    url: typeof value.url === "string" ? value.url : "",
    checkedAt: Number.isFinite(value.checkedAt) ? value.checkedAt : Date.now(),
    error: typeof value.error === "string" ? value.error : "",
  };
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  return body;
}

/** "v1.7.20" / "1.7.20" / "v1.7.20-beta.1" → "1.7.20" / "1.7.20-beta.1"。 */
export function normalizeVersion(tag) {
  return String(tag || "").trim().replace(/^v/i, "");
}

function coreParts(v) {
  return normalizeVersion(v)
    .split(/[-+]/)[0]
    .split(".")
    .filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x));
}

function preParts(v) {
  const hit = normalizeVersion(v).match(/^[^-+]*[-+](.+)$/);
  return hit ? hit[1].split(".").filter(Boolean) : [];
}

/**
 * 段式比较：先比核心段（数字按数值），核心段相同再比预发布段。
 * 预发布段存在即低于正式版：1.7.20 > 1.7.20-rc.1。返回值 -1 / 0 / 1。
 */
export function compareVersions(a, b) {
  const left = coreParts(a);
  const right = coreParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = typeof x === "number";
    const ny = typeof y === "number";
    if (nx && ny) {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    if (nx !== ny) return nx ? 1 : -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  const pa = preParts(a);
  const pb = preParts(b);
  if (!pa.length && !pb.length) return 0;
  if (!pa.length) return 1;
  if (!pb.length) return -1;
  const plen = Math.max(pa.length, pb.length);
  for (let i = 0; i < plen; i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
      continue;
    }
    // 预发布段里数字标识符低于字母标识符（semver 规则）。
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 本地版本是否落后于上游。 */
export function isBehind(localVersion, upstreamVersion) {
  if (!upstreamVersion) return false;
  if (!localVersion) return true;
  return compareVersions(localVersion, upstreamVersion) < 0;
}

async function defaultFetcher(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "dsh-purge-community/upstream-watch",
      accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 查上游最新正式版。带 6 小时缓存；force 时跳过缓存。
 * 永不抛错：失败时返回上一次成功的结果 + error 字段。
 */
export async function checkUpstream({
  dshHome,
  force = false,
  ttlMs = DEFAULT_TTL_MS,
  fetcher = defaultFetcher,
  now = () => Date.now(),
} = {}) {
  const cached = readUpstreamCache(dshHome);
  const fresh = cached.checkedAt > 0 && now() - cached.checkedAt < ttlMs;
  if (!force && fresh && cached.version) return { ...cached, fromCache: true };
  try {
    const data = await fetcher(
      `https://api.github.com/repos/${UPSTREAM_REPOSITORY}/releases/latest`,
    );
    const version = normalizeVersion(data?.tag_name || "");
    if (!version) throw new Error("no tag_name");
    const url = typeof data?.html_url === "string" ? data.html_url : "";
    const written = writeUpstreamCache(dshHome, {
      version,
      url,
      checkedAt: now(),
    }) || { version, url, checkedAt: now() };
    return { ...written, fromCache: false };
  } catch (e) {
    const error = String((e && e.message) || e);
    // 失败不清掉上次成功的结果：面板还能告诉你"上次看到的上游版本"。
    return { ...cached, error, fromCache: true };
  }
}
