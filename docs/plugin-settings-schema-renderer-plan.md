# 插件设置 Schema 渲染器 — 实施规格（下一步开工用）

## 目标
手机插件详情的「功能选项」改为 schema 驱动动态表单，内容/控件与 dsh 端一致。

## 已确认事实
- `parseNamespace()` 已带回 `namespace.schema`（此前无人消费）：形状为 schemastery 序列化
  `{ uid, refs: { [uid]: node } }`；根节点 = refs[schema.uid]。
- node 结构（schemastery）：`{ type: 'object'|'dict'|'string'|'number'|'boolean'|union|array...,
  dict?: { key: uid }, inner?: uid, list?: uid[], meta: { default?, description?, title?, options?, row? } }`。
  union 的分支 = number 数组（各分支 uid）；enum 常见为 union of literals（meta.options 或分支字面量）。
- 网关只转发：plugin-settings(ns) / plugin-settings-mutate(ns, revision, ops set/unset path[])。
- 事件：plugin-settings-changed {ns, revision} → 已在客户端接 AppStorage 'pluginSettingsRevision'。

## 待办（按序）
1. 抓真实响应：装机包已带 [SCHEMA] 日志（tryLoadSettings 成功分支打印 ns + schema 前 1800 字符）。
   手机打开「终端」/「网页搜索与获取」详情一次 → hilog grep '[SCHEMA]' → 按真实 refs 定 walker。
2. CodeHighlighter 同目录新建 SettingsSchemaWalker.ets：
   resolveRefs(schema, uid) → 扁平字段列表 [{ path: string[], kind, label, hint, options?: string[] }]；
   object 递归展开（path 段拼接），union 解出字面量选项；meta.title/description 缺省回退 key。
3. PluginsPage：buildFields 换成 walker 结果；渲染 string/number → TextInput（现样式）、
   boolean → Toggle、enum → 点击弹列表选择（bindMenu 或 BottomSheet 简版）、unknown → 文本兜底。
4. 保存沿用 plugin-settings-mutate（op set/unset，path = 字段 path 段）。
5. 自定义控件二阶段：
   - 模型多选：数据源 models 帧（已有 provider/model），按 provider 分组 checkbox，值 = 授权模型列表
   - 设备下拉：语音插件运行时设备列表来自主机（需网关补充代理接口或插件状态帧），一期以文本兜底
6. 状态卡（云端就绪/资源准备）：需要主机推送插件运行状态帧（PROTOCOL 暂无），后续网关+主机排期。

## 注意
- 与并行会话共享 PluginsPage.ets：改前先 git pull/status，避免覆盖其发现页样式迭代。
- 插件市场图标/更新卡/组件行已上线：ac6ec88、0b74d41、564e62f3、71541545、16fd9618。
