# 这个 fork 多了什么

上游：[kingcharleslzy-ai/dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge)。改动只有两处，且都尽量落在**新文件**里，方便自动同步上游。

## 1. 破甲总开关（关 = 真还原）

状态页「应用 / 还原 / 卸载」下方多一个开关：

- **打开**：恢复提示词注入，并自动调用一次「应用」把宿主补丁写回。
- **关闭**：写 `$DSH_HOME/dsh-purge/master-switch.json`，随即
  1. 注入全停——任何预设、会话、子代理、host 兜底路径、assembly 重写、refusalRetry 都不再注入；
  2. `rewriteLiveAssembly` 把插件写过的段落还原成宿主原文，请求里不再有那 20K 字破甲稿；
  3. 回退全部宿主补丁与 shim；
  4. 关掉破甲强化段（原偏好记在开关文件里，打开时还原）；
  5. 启动自愈跳过写盘，关闭状态下点「应用」返回 409。

  `prompt-inject.md`、备份、面板一律保留。两种状态都要**完全退出并重开 DSH**。

等价操作：`/purge master off|on|status`、CLI `purge master off`、工具 `purge_master`。删掉开关文件即等于打开。

实现落在：`lib/master-switch.js`、`lib/fork-features.js`（路由/命令/工具）、面板 `MasterSwitch` 组件；
对上游文件的接线只有 `lib/index.js` 的几行（约 +44/−24）。

## 2. 自动更新不覆盖 fork

`REPOSITORY` **保持指向上游**，所以「检查更新」照常提示上游有新版本（就是你要的上游提示）。
但在 `lib/update.js` 里加了一条保护：**从 `github:` / `git+` 源码安装的站点跳过自动安装**，
否则某天自动更新会把上游发行包换进来，本 fork 的开关就没了。手动点更新仍可选择。

## 3. 跟随上游（自动合并）

- `scripts/sync-upstream.mjs`：`git fetch upstream && merge` → 只自动解决构建产物 `client.js` 的冲突（取上游那份再重建）；源码/文档冲突会 **abort 并列文件**，不会"全取上游"抹掉本 fork。
- `.github/workflows/sync-upstream.yml`：每天 04:23 自动跑同一流程并推送（fork 需在 Actions 页启用一次）。
- `.github/workflows/build.yml`：每次推送都重建 `client.js` 并校验（产物与源码一致、文档版本一致、fork 单测），产出可安装 TGZ 与 SHA256SUMS；打 `v*` tag 时自动发 Release。

## 4. 校验

```bash
npm run check:client   # 产物 == 源码
npm run check:docs     # 文档版本一致
node --test test/master-switch.test.mjs
```

## 5. 约束

- 只改本仓库；不改 `~/.dsh` 下的宿主文件、不自动重启、不自动应用。
- `prompt-inject.md` 只读，除非用户点保存。
- 关闭开关只做策略门控，不删除注入稿。
