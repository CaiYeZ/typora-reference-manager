# Typora Reference Manager

基于 Typora Community Plugin 的文件引用与常用链接管理扩展。当前版本：**0.1.18**。

## 功能

- 输入 `/ref` 搜索工作目录内的文件，插入标准 Markdown 链接。
- 链接显示文本去掉最后一个文件扩展名，目标路径保留完整文件名，例如 `[note](./note.md)`。
- 输入 `/fav` 搜索保存的常用引用，保留自定义名称。
- 在同一弹窗中新增或编辑名称和地址；通过“保存”或“取消”关闭弹窗。
- 候选框显示约 3 行，可滚轮浏览，也可用方向键和 Enter 选择。
- 支持中文输入法组合输入及 `／ref`、`、ref`、`／ｒｅｆ` 等前缀，`/fav` 同理。
- 启动、工作目录挂载时自动刷新索引，并提供手动刷新和可配置快捷键。

## 环境要求

manifest 声明：Windows、Typora ≥ 1.14.0、Typora Community Plugin ≥ 2.9.14。

## 安装与升级

1. 从本仓库 Releases 下载 `typora-reference-manager-v0.1.18.zip`。
2. 关闭 Typora，解压得到 `typora-reference-manager` 文件夹。
3. 放入 `%USERPROFILE%\.typora\community-plugins\plugins\`。
4. 确认 `main.js`、`manifest.json` 和 `style.css` 直接位于该文件夹中。
5. 重启 Typora，在 Community Plugin 中启用 Reference Manager。

升级时替换这三个文件。插件 ID 保持为 `local.reference-manager`，以兼容已有设置和常用引用。GitHub 自动提供的 Source code ZIP 是仓库快照，安装请优先使用带版本号的安装包。

## 使用

| 操作 | 方法 |
| --- | --- |
| 插入文件链接 | 输入 `/ref` 后继续输入文件名或路径 |
| 插入常用引用 | 输入 `/fav` 后继续输入保存的名称 |
| 新增常用引用 | 默认 `Alt+Ctrl+R`，或设置页“新增” |
| 手动刷新索引 | 默认 `Alt+Ctrl+I`，或命令面板“引用管理器：刷新文件索引” |
| 修改刷新快捷键 | 设置 → Reference Manager → 手动刷新快捷键，修改后立即生效 |

常用引用支持网址、绝对文件路径和相对于工作目录的文件路径。图片作为普通链接插入，不嵌入正文。文件扫描跳过 `.git`、`.typora`、`node_modules`、`.idea`、`.vscode`；文件移动后可手动刷新索引。

## 0.1.18 更新

`/ref` 生成链接时，显示文本移除最后一个扩展名，实际链接路径不变。`/fav` 继续使用自定义名称。保留此前中文输入法、候选框键盘操作和常用引用弹窗修复。

## 开发与打包

本仓库从已安装的 0.1.18 版本整理，`main.js` 是直接可编辑的发布入口，未包含历史提交。无需安装 npm 依赖。

在仓库根目录运行 PowerShell：

```powershell
./scripts/package.ps1
```

输出到 `release/`：安装 ZIP 与 SHA-256 校验文件。ZIP 只包含固定插件目录下的三个运行文件。`release/` 不加入 Git，发布时作为 GitHub Release 附件上传；标签应与 manifest 版本一致。个人常用引用、插件设置和索引缓存不属于仓库内容。

## 许可

当前未指定开源许可证。
