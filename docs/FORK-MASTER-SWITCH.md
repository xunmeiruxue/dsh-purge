# 这个 fork 多了什么

上游：[kingcharleslzy-ai/dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge)。本 fork 只加了两件东西，其余保持一致。

## 1. 破甲总开关（真还原）

状态页「应用 / 还原 / 卸载」下方多了一个开关：

- **打开**：恢复提示词注入，并自动调用一次「应用」把宿主补丁写回。
- **关闭**：写 `$DSH_HOME/dsh-purge/master-switch.json`，随即
  1. 注入全停——任何预设、任何会话、子代理、host 兜底路径、assembly 重写、refusalRetry 都不再注入；
  2. `rewriteLiveAssembly` 直接把插件写过的段落还原成宿主原文，请求里不再有那 20K 字破甲稿；
  3. 回退全部宿主补丁与 shim；
  4. 关掉破甲强化段（原偏好记在开关文件里，打开时还原）；
  5. 启动自愈跳过写盘，关闭状态下点「应用」被 409 拒绝。

  `prompt-inject.md`、备份、面板一律保留，随时可以再开。两种状态都要**完全退出并重开 DSH**。

等价操作：`/purge master off|on|status`、CLI `purge master off`、工具 `purge_master`。
开关文件删掉即等于打开。

## 2. 更新来源指回自己 + 上游只读提示

- `lib/community.js` 的 `REPOSITORY` 改成 `xunmeiruxue/dsh-purge`：内建的自更新不再把上游包悄悄装进来（那会覆盖本 fork）。
- 新增 `lib/upstream-watch.js` 与 `GET /dsh-purge/upstream`：只读查上游 Release，6 小时缓存，维护页显示一行「上游有新版本 vX（只提示）」，附「打开上游」链接。它**不参与安装**，装什么永远由你决定。

## 3. 跟随上游

构建产物 `client.js` 已入库，安装时不需要构建；所以同步上游的冲突几乎只会出现在这个文件上。

### 手动（本地）

```bash
node scripts/sync-upstream.mjs           # 合并 + 重建 + 校验 + 提交
node scripts/sync-upstream.mjs --push    # 顺带推送
node scripts/sync-upstream.mjs --dry-run # 只看上游新增了多少提交
```

规则：**只有 `client.js` 的冲突会被自动解决**（取上游版本再重建）；源码/文档冲突会 abort 并列出文件，交给人处理——脚本不会用"全取上游"的方式悄悄抹掉本 fork 的改动。

### 自动（GitHub Actions）

`.github/workflows/sync-upstream.yml` 每天 04:23（Asia/Shanghai）跑一次同样的流程并推送。fork 的 Actions 默认是关的，需要去仓库 **Actions → 启用** 一次。

## 4. 校验

```bash
npm run check:client                     # 产物与源码一致
npm run check:docs                       # 文档与版本号一致
node --test test/master-switch.test.mjs test/upstream-watch.test.mjs
```

## 5. 本 fork 自己的约束

- 只改本仓库；不改 `~/.dsh` 下的宿主文件、不自动重启、不自动应用。
- `prompt-inject.md` 永远只读，除非用户点保存。
- 关闭开关只做策略门控，不删除注入稿文件。
