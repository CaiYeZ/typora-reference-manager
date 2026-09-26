## 0.1.21 更新：Ctrl+K 链接显示名规则

- 在正文或源码模式选中完整 HTTP(S) 裸网址后，按 Ctrl+K，按顺序使用首条有效匹配生成链接。
- 默认内置 B 站 BV 号规则，例如将网址显示为 BV1g6hR6pEmv，目标网址保持原样。
- 设置页支持规则新增、编辑、删除、启停和排序；保存后立即生效，重启后保留。
- 正则使用 JavaScript 语法，不加 / 分隔符，须匹配整个网址；模板支持 $1～$99 捕获组，结果按普通文字转义。
- 未命中、功能关闭或选区不完整时保留 Typora 原生 Ctrl+K；已有链接、代码、图片及设置输入框不处理。同段或源码同一行含反引号、方括号或尖括号时保留原生行为。
- 支持撤销，不联网获取标题，不解析短链接，不影响 /ref、/fav 或收藏名称。

## 安装与升级

下载 typora-reference-manager-v0.1.21.zip，关闭 Typora，解压后将 typora-reference-manager 文件夹放入 %USERPROFILE%\.typora\community-plugins\plugins\，替换旧版运行文件并重启。已有设置和常用引用保持兼容。

安装包仅包含 main.js、manifest.json 和 style.css，同时提供 SHA-256 校验文件。安装请优先使用上述版本安装包。

AI 辅助开发项目：由作者提出需求，通过 ChatGPT / Codex 辅助编写代码、迭代功能和整理发布文档。
