# ShoeStock · 鞋子库存管理器

一个只在手机上跑的离线库存工具：管理鞋子的**分类、数量、码数**，支持**语音改库存**。
没有服务端，数据全部存在手机本地的 SQLite 里。

---

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| UI | Vue 3.5 + Vite 8 + TypeScript | 与常见 Web 前端同一套语言，无需学移动端专属语法 |
| 组件库 | Vant 4 | 移动端组件，省掉大量样式代码 |
| 状态 | Pinia | 库存会在多处被改，统一用 store 刷新 |
| 原生容器 | Capacitor 8 | 把 Web 项目包成 Android APK，只需要 3 条命令 |
| 数据库 | `@capacitor-community/sqlite` 8 | 原生 SQLite；浏览器调试时自动降级为 jeep-sqlite |
| 语音识别 | `@capgo/capacitor-speech-recognition` 8 | 系统原生识别，**免费、免 key、可端侧运行** |
| 文件读写 | `@capacitor/filesystem` 8 | 备份导出到手机公共文档目录 |

> **版本对齐规则**：Capacitor 插件的主版本号必须与 Capacitor 主版本一致。
> 升级 Capacitor 时，所有 `@capacitor*` / `@capgo*` 插件要一起升。

**不需要任何 API 凭证**：语音走系统原生识别，数据在本地。项目里没有 `.env` 要填。

---

## 本机开发（浏览器，最快）

```bash
npm install
npm run dev
```

浏览器会自动用 jeep-sqlite 把数据存在 IndexedDB 里 —— **跟手机上的原生 SQLite 是同一套 SQL**，
所以在浏览器里调通的功能，打包后行为一致。

两个例外：
- **麦克风**：浏览器环境不支持系统语音识别，页面会明确提示并给出「手动输入指令」通道。
- **语音页仍然可测**：手动输入一句指令，后面的解析 → 匹配 → 确认 → 写库链路与语音完全一致。

```bash
npm run type-check  # 类型检查
npm run test        # 解析器单元测试（13 条）
npm run build       # 产出 dist/
```

> `npm install` 里的 postinstall 会自动把 `sql.js` 的 wasm 拷到 `public/assets/`。
> 少了这一步，浏览器里会因为加载不到 `sql-wasm.wasm` 而初始化失败。

---

## 打包 APK（需要你本机装 Android Studio）

Android Studio 自带 JDK 21 和 Android SDK，装完不需要额外配环境变量。

```bash
npm run android        # = vite build && cap sync android && cap open android
```

第一次会让你选 Gradle JDK（选 21），之后在 Android Studio 里：
`Build → Build Bundle(s) / APK(s) → Build APK(s)`。

**注意**：以下平台配置是 SQLite 插件要求的，缺失会编译失败（在 `android/variables.gradle`）：

```
minSdkVersion = 23
compileSdkVersion = 35
targetSdkVersion = 35
```

Gradle JDK 21 / Android Gradle Plugin 8.7.2。

---

## 目录结构

```
src/
├── db/
│   ├── schema.ts              # 四张表的建表 SQL + 版本化迁移
│   ├── connection.ts          # 连接封装，原生/Web 双通道 + 事务
│   └── repositories/          # 唯一允许出现 SQL 的地方
│       ├── categoryRepo.ts
│       ├── productRepo.ts
│       ├── skuRepo.ts         # SKU 矩阵查询、模糊匹配候选
│       └── stockLogRepo.ts    # 流水
├── services/
│   ├── stockService.ts        # ★ 库存变动的唯一入口
│   ├── nlu.ts                 # 语音文本 -> StockCommand 的规则解析
│   ├── nlu.spec.ts            # 解析器的回归测试
│   ├── asr.ts                 # 语音识别通道（只负责声音 -> 文字）
│   └── backup.ts              # 导出 JSON/CSV 备份、恢复
├── utils/error.ts             # 异常 -> 人话
├── stores/catalog.ts          # Pinia：款式列表、当前款 SKU
├── views/                     # 库存 / 语音 / 录入 / 流水 / 设置
└── types.ts                   # 领域类型 + 单位换算
```

---

## 三个不容商量的设计约束

改代码前请先看 `docs/01-AI施工提示词.md` 末尾的反例清单。这里是其中最关键的三条：

1. **金额存「分」，鞋码存「十分之一码」，一律整数。**
   鞋码有半码，用 `double` 会出现 `42.5 !== 42.5`，导致改 42.5 码时匹配不到 SKU。

2. **写库存的代码只有一个入口：`confirmApply()`。**
   `applyCommand()` 只算不改，返回值用来渲染确认卡；用户点头后才 `confirmApply()`。
   语音、手动按钮、将来的扫码，都必须先变成 `StockCommand` 再进来。

3. **改库存必须同时插流水，且在同一事务里。**
   `sku.stock` 只是当前快照，`stock_log` 才是账目本身。撤销靠插入反向记录，不删历史。

---

## 语音链路是怎么工作的

```
说话 → 系统识别 → 文本 → nlu 解析 → StockCommand
     → applyCommand 算出"将发生什么" → 确认卡 → confirmApply 写库 + 记流水
```

关键点：**语音只承担「输入一句话」这一件事。** 从文本往后，与手动输入走完全相同的代码。
所以国产 ROM 没预装语音引擎、没给麦克风权限、环境太吵时，
语音页的输入框不是降级方案，而是同一条路上的另一个入口。

识别到的原文会显示出来且可编辑 —— 识别错了用户得看得见、改得动。
确认卡一步都不能省：改错一次账要人工翻流水，代价远高于多点一下。

---

## 备份

数据只在手机本地，没有云端副本。设置页可以：

- 导出完整备份（JSON）：四张表全量，可用来完整恢复
- 导出库存表（CSV）：带 BOM，Excel 直接打开不乱码
- 从备份恢复：**整体替换**当前数据（会二次确认）
- 清空全部数据

建议每周导出一次。

---

## 还没做的部分

- 条码/二维码扫描录入
- 批量补货表格（一次录入多码多数量）
- 多设备同步（需要引入服务端，与"离线优先"的定位冲突，暂不做）
