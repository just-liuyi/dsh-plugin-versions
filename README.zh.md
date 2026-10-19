# dsh-plugin-versions

在 **设置 → 插件** 里加一个「已安装插件」页：列出已装插件的全部历史版本，可切换、回滚、卸载。所有操作都走宿主自己的 `pluginManager` 服务。

[English](./README.md) | 中文

## 为什么做这个

官方插件管理器有意不做版本选择：第三方插件只能「卸载 + 重装」来换版本，只有官方 on-demand 条目才有显式的 **Update** 按钮。想钉住一个已知可用的版本，或者在某个版本出问题后退回去，只能手改 `package.json`。

这个插件补的就是这一块，不重做市场，也不重做安装器。

## 功能

- 列出当前 profile 安装的 bundle：版本、来源 spec、是否可卸载
- 展开某个插件 → 从 registry 拉取它的全部已发布版本（发布时间、`latest`、已弃用标记）
- 切换版本走 `pluginManager.removeBundle` → `pluginManager.installBundle`，并把依赖钉成精确版本
- **自动回滚**：目标版本装失败（peer 门、版本不存在、网络）时，自动装回原版本并报告失败原因
- 同一个页签里可以卸载 profile bundle
- 使用 profile 配置的 registry（私有源可用），读不到时退回 `registry.npmjs.org`

## 安装

npm 包还没发布，先从仓库装：

```bash
dsh plugin --profile <name> add github:DangDangDeng/dsh-plugin-versions
```

或者用完整 Git 地址：

```bash
dsh plugin --profile <name> add git+https://github.com/DangDangDeng/dsh-plugin-versions.git
```

DSH Desktop 的 `desktop` profile 由应用独占管理，CLI 装不了，请在 **插件 → 添加插件** 里填 `github:DangDangDeng/dsh-plugin-versions`。装完重启或刷新页面。需要锁版本时在末尾加 `#<tag>` 或 `#<commit>`。

npm 发布之后，`dsh plugin add dsh-plugin-versions` 也可以直接用。

## 使用

1. 打开 **设置 → 插件**
2. 切到 **已安装插件** 页
3. 展开某个插件看它的版本列表：当前版本、`latest`、发布日期都标着
4. **切换** 会先确认，然后卸载旧版本、安装目标版本；失败自动回滚
5. **卸载** 移除 bundle，配置数据保留

切换后请刷新页面，浏览器才会加载另一个版本的客户端半边。

## 切换的真实流程

```
pluginManager.listBundles()        找到这个已装 bundle，记下当前版本
pluginManager.removeBundle(name)   卸载并移除依赖
pluginManager.installBundle(name@version, { saveExact: true, enabled: true })
   ├─ 成功 → ChangeResult.application: applied | restart-required
   └─ 失败 → 清掉半装状态，装回原版本
```

在 HMR profile 里，`installBundle` 对「已安装的包」会直接返回 `already-installed`，所以必须先卸载。兼容性检查由宿主在跑 pnpm 之前完成，不兼容会直接报错、不落盘。

## HTTP 接口

客户端半边只通过一条环回路由访问宿主：

```
POST /plugin-versions/api/{list|versions|switch|remove}
```

请求必须带 `x-requested-with: XMLHttpRequest`、不能是 `sec-fetch-site: cross-site`、`Host` 必须是环回地址（`127.0.0.1`、`localhost`、`::1`）。只有本 profile 已安装的 bundle 能被切换或卸载，所以这条路由不会变成任意包安装器。

## 已知限制

- 仅环回：通过 `--trusted-host` 从别的机器打开的页面会被拒绝
- 不做自动更新检查——它是版本浏览器，不是更新器
- 不逐版本预判兼容性：不兼容由宿主拒绝，随后自动回滚
- 没有 HMR 的 profile 切换后会报 `restart-required`
- 切换到新版本后需要刷新页面

## 开发

纯 ESM，无构建步骤：

```
index.js          宿主半边：HTTP 路由 + pluginManager 调用
client.js         浏览器 bundle：把「版本」页签注册进 plugins.tab
cordis.patch.yml  插入 bundle 行
locale/*.json     bundle 标题与描述
```

用绝对路径安装（`dsh plugin add <path>` 或界面里的「添加插件」），目录是软链的，改完重启即可生效。

## 许可证

MIT
