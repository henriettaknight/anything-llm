# Tauri 桌面端缺陷类目（可选类目包）

> 本文件为 **Tauri 桌面端** 项目的「可选类目包」，仅在 `projectType` 包含桌面端能力时由后端拼接进提示词（如 `ts_famegame`）。纯前端 TypeScript 项目不拼接本文件，不会出现 TAURI 类目缺陷。本文件对应通用内核 `ts_prompt.md` 类目表中 `TAURI` 行的正文。

---

### TAURI — 桌面端 / Tauri 缺陷

**定义**：Tauri 桌面端特有缺陷，含 IPC、路径、资源协议、原生交互。**编辑器目标误用游戏能力、Steam 能力未隔离等违反架构约束（2.7.8）的 Tauri 问题归 ARCH**。

**检测要点**：
- **invoke 参数命名**：`invoke('cmd', { camelCase: val })` 自动转 Rust 的 `snake_case`，参数名须与 Rust 命令参数匹配。
- **invoke 未处理错误**：`await invoke(...)` 无 try/catch，Rust 端 `Err` 会 reject。
- **路径分隔符**：Windows 用 `\`，硬编码 `/` 拼接可能出错。应统一用 `pathe`/`@/utils/path` 的 `join`，而非手动 `+ "/"`。
- **资源协议处理**：`content://`、`resources://` 须先 `unwrapUri` 转实际路径，直接用协议字符串访问文件系统失败。
- **convertFileSrc 误用**：只能转 `asset://` 或本地绝对路径，传自定义协议无效。
- **appDataDir 异步路径未初始化**：`tauriResourcePath()` 须在 `__initTauriPaths` 完成后用，否则抛 "not initialized"。检查初始化时序。
- **SQL plugin 路径前缀**：`Database.load("sqlite:" + path)` 前缀须正确。
- **plugin-fs 权限（违反 2.7.8，归 ARCH）**：`exists`/`mkdir`/`readFile` 需在 `capabilities` 声明权限。
- **环境变量**：`process.env.NODE_ENV` 在 Vite 前端需通过 `define` 注入，应优先用 `import.meta.env`。
- **大文件读写**：应使用流式 API，避免一次性 `readTextFile` 加载进内存。
- **插件 guest-js 与 Rust 类型同步**：须手写同步，禁止依赖自动推断。
- **编辑器目标误用游戏能力（违反 2.7.8，归 ARCH）**：编辑器构建下不应调用游戏专属 Tauri 能力。

**示例**：
```typescript
// ❌ 路径硬编码分隔符
const dbPath = basePath + "/save/" + dbName; // Windows 可能出错
// 正确：import { join } from 'pathe'; const dbPath = join(basePath, 'save', dbName);

// ❌ 资源协议未转换直接用
await readFile("resources://images/icon.png"); // 需先 unwrapUri(url) 转实际路径

// ❌ tauriResourcePath 初始化前调用
const path = tauriResourcePath(); // __initTauriPaths 未执行则抛异常

// ❌ invoke 参数名不匹配后端
await invoke('http_post_game_actions', { channelId: 1 }); // 后端期望 channel_id
```
