# FameGameEditor 项目上下文

> 本文件为 **FameGameEditor** 项目的「项目上下文」附加章节，与通用内核 `ts_prompt.md` 由后端按 `projectType=ts_famegame` 拼接后下发。其中「架构关键约束 2.7.x」是内核 ARCH 类目的**具体约束清单与检测要点**；「必检模块」与「重点关注项」是内核第四节的细化。模型应将本文件视为内核提示词的连续章节。
>
> 若未来接入其他 TypeScript 项目，只需新增一份类似的 `ts_contexts/<项目名>.md`，后端 `PROMPT_FILES` 增加一行映射，代码零改动。

---

## 一、项目概述

本项目（`FameGameEditor`）是一个**事件驱动的交互式视频游戏编辑器**，同时承担「编辑器」与「游戏运行时」两种形态，通过 `VITE_GAME_MODE` 环境变量与条件编译指令在构建期切换产物：

- `VITE_GAME_MODE` 未设置 → 编辑器路由（`src/Routes.tsx`）
- `VITE_GAME_MODE == 1 || 2` → 游戏路由（`src/RoutesGame.tsx`）

三个构建目标：`editor` / `game` / `steam-game`，分别对应 `build_conf/` 下的 tauri 配置。

---

## 二、技术栈

- **运行时**：Tauri 2（Rust 后端 + WebView 前端），桌面端环境，非纯浏览器
- **语言**：TypeScript 5.6，`strict: true`、`noFallthroughCasesInSwitch: true`，但 `noUnusedLocals/Parameters: false`；`experimentalDecorators: true`、`useDefineForClassFields: false`；`target: ES2021`、`moduleResolution: bundler`、`jsx: react-jsx`
- **框架**：React 18（函数组件 + Hooks），JSX
- **状态管理**：Zustand 5 + immer 中间件 + zundo（undo/redo），`create<T>((set, get) => ({...}))`
- **UI 库**：Mantine 7、Radix UI（shadcn/ui）、TailwindCSS 4、clsx/tailwind-merge（`cn()` 工具位于 `src/lib/utils.ts`）
- **路由**：react-router 7
- **数据持久化**：Tauri SQL plugin（SQLite），`Database.load("sqlite:...")`
- **编辑器**：@xyflow/react（节点图）、@dnd-kit（拖拽）、@xzdarcy/react-timeline-editor（时间轴）
- **媒体**：xgplayer、video.js、howler（音频）、lottie-react
- **工具库**：ahooks、lodash-es、rxjs、crypto-js、uuid、pathe
- **国际化**：i18next + react-i18next
- **构建**：Vite 6 + Bun + 条件编译（vite-plugin-conditional-compiler）
- **路径别名**：`@/*` → `./src/*`，`@tauri-plugins/*` → `./src-tauri/plugins/*`
- **资源协议**：自定义 `content://`（项目内容目录）、`resources://`（Tauri 资源目录）协议，经 `unwrapUri/wrapUri` 转换

---

## 三、目录结构（关键部分）

```
src/
├── App.tsx                  # 入口，按 VITE_GAME_MODE 选择路由
├── Routes.tsx               # 编辑器路由
├── RoutesGame.tsx           # 游戏路由
├── pages/                   # 页面级组件（Home/Editor/Game/Login/Project）
├── components/
│   ├── Editor/              # 编辑器三大子编辑器
│   │   ├── node-editor/     # 剧情节点编辑器（时间轴 + 画布）
│   │   ├── story-tree-editor/ # 剧情树编辑器（基于 @xyflow/react）
│   │   └── wgt-editor/      # UI 组件（.wgt）编辑器
│   ├── Game/                # 游戏运行时
│   │   ├── system/          # 七大子系统（ui/story/value/resource/message/audio/achievement）
│   │   ├── events/          # eventBus$（RxJS Subject + 延迟代理）
│   │   ├── caches/          # 资源缓存（cacheDB）
│   │   └── hooks/           # 游戏运行 hooks
│   ├── Common/              # 公共能力（tree/wgt-reference/canvas/i18n）
│   └── Builder/             # 构建器
├── plugins/FameGame2/       # 项目专属插件（组件/资源）
├── lib/utils.ts             # cn() 等工具
└── assets/

src-tauri/
├── plugins/                 # Tauri 原生插件（Rust + guest-js）
│   ├── resource-system/     # 资源元数据解析
│   ├── snail-security/      # 加密
│   └── steam/               # Steam 集成
└── resources/data/          # 默认数据（event/layout/main/media.json）
```

设计文档位于 `doc/`：`游戏架构设计.md`、`编辑器功能设计.md`、`剧情树可达性方案设计.md`，是架构合规判断的依据。

---

## 四、条件编译指令

代码中存在如下指令，**不可破坏其结构**：
```ts
// #v-ifdef VITE_GAME_MODE == 1 || VITE_GAME_MODE == 2
import "./Game.css";
// #v-endif
```
检测时需注意：同一文件可能在不同构建目标下行为不同，需结合 `import.meta.env.VITE_GAME_MODE` 判断分支可达性，验证 editor / game / steam-game 三种目标下是否均正确。

---

## 五、状态管理约定

- **编辑器侧**：`zustand` + `immer` 中间件；部分 store 拆分为 slices（见 `story-tree-editor/store/slices/`）
- **撤销重做**：`zundo`（`history-slice.ts` / `use-node-history.ts` / `use-widget-history.ts`），连续同类操作（如拖拽）须使用 `mergeKey` 合并
- **游戏侧**：`createStore`（非 hook 形式）+ React Context 注入，避免单例污染多实例
- **事件总线**：`eventBus$`（RxJS Subject，经 Proxy 包装支持 `payload.delay` 延迟分发），订阅返回的 `Subscription` 必须在组件卸载时 `unsubscribe`

---

## 六、命名与导出约定

- 组件文件：`PascalCase.tsx` 或 `kebab-case.tsx`（页面级用 `index.tsx`）
- hooks：`use-*.ts` / `use_*.ts`（两种风格并存，新代码建议统一为 `use-*.ts`）
- store：`*-store.ts` 或 `*.store.ts`（两种风格并存）
- 工具：`utils.ts` / `*-utils.ts`，公共工具统一放 `lib/` 或 `components/Common/`
- 默认导出与命名导出混用：路由级组件常用命名导出（如 `NodeEditorContainer`）

---

## 七、架构关键约束（业务级，违反即缺陷）

> 以下 8 条约束是架构合规判断的核心，违反任一条即构成 ARCH 类目缺陷（详见内核「单一归类原则」）。内核 ARCH 类目正文会回引对应约束编号（如「违反 2.7.1」），便于按类排查时对照，但最终归类以「单一归类原则」为准。

1. **子系统解耦**：`Game/system/` 下各子系统通过 `eventBus$` 通信，不应直接互相 import 内部实现
2. **数据快照与缓存**：`nodes-data-store.ts` 区分 `cacheChapterNodesData`（本地缓存）与 `chapterNodesData`（内存最新），二者不可混用
3. **.wgt 资源**：`WidgetInstance.overrides` 仅保存与模板差异部分，需经 `pickKnownProps` 过滤失效属性
4. **时间轴派生与临时态**：`EventTimelineAction.selected` 由 `applySelectedFlag` 派生，不应手动维护；拖拽期间禁止 `setEditorData`，应使用 `liveDragLayout` 临时态
5. **撤销栈合并**：连续同类操作（如属性拖拽、连续按键）必须使用 `mergeKey` 合并，避免撤销步数爆炸
6. **可达性算法**：见 `doc/剧情树可达性方案设计.md`，使用数值栈缓存链路变更，不得绕过栈机制直接读全局变量
7. **i18n 通道**：文案应走 `i18n-text.ts` / `localized_text_store.ts`，禁止硬编码中文（资源名、调试日志除外）
8. **条件编译与 Tauri 能力隔离**：`#v-ifdef` / `#v-else` / `#v-endif` 必须配对；需分别检查 editor / game / steam-game 三种目标下的可达性；Steam 相关能力仅在 `steam-game` 目标下可用，需用条件编译隔离；`@tauri-apps/plugin-*` 调用需在 `src-tauri/capabilities/default.json` 中授权

---

## 八、必检模块

1. `src/components/Editor/node-editor/` —— 时间轴、画布、属性面板、撤销栈
2. `src/components/Editor/story-tree-editor/` —— 流程图、自动布局、可达性
3. `src/components/Editor/wgt-editor/` —— slot 系统、组件实例缓存
4. `src/components/Game/system/` —— 七大子系统及 `baseSystem.ts`
5. `src/components/Game/events/` —— `eventBus$` 与 `eventManager.ts`
6. `src/components/Game/caches/` —— 缓存一致性（cacheDB）
7. `src/components/Editor/common/history/` —— zundo 集成
8. `src-tauri/plugins/*/guest-js/` —— Tauri 插件前端桥接

---

## 九、重点关注项

- **条件编译块**：`#v-ifdef` / `#v-endif` 是否配对、是否覆盖所有目标（违反 2.7.8）
- **Tauri 能力调用**：`@tauri-apps/api`、`@tauri-apps/plugin-*` 是否在编辑器目标下误用游戏专属能力（违反 2.7.8）
- **store 单例污染**：游戏侧是否误用 `create()`（hook 形式）导致多实例共享
- **事件订阅清理**：`useEffect` 中订阅 `eventBus$` 是否返回 `unsubscribe`（违反 2.7.1）
- **immer 不可变更新**：是否存在直接 mutate 非 draft 对象
- **时间轴性能与派生**：拖拽中是否使用 `liveDragLayout` 临时态而非直接落库（违反 2.7.4/2.7.5）；`selected` 是否被手动维护（违反 2.7.4）
- **流程图节点数**：`@xyflow/react` 大图是否启用虚拟化/按需渲染
- **数据快照区分**：`cacheChapterNodesData` 与 `chapterNodesData` 是否混用（违反 2.7.2）
- **overrides 过滤**：写入 `WidgetInstance.overrides` 前是否经 `pickKnownProps` 过滤（违反 2.7.3）

---

## 十、ARCH 类目具体检测要点（对应内核 ARCH 类目）

> 以下为内核 ARCH 类目「检测要点」中"具体约束清单与编号"的展开，供逐条对照。

**检测要点**（逐条对照 2.7）：
- **2.7.1 子系统耦合**：`Game/system/` 下七大子系统（ui/story/value/resource/message/audio/achievement）应通过 `eventBus$` 通信，不应直接互相 import 内部实现。检测 `import` 语句跨子系统引用非公开 API。**eventBus$ 订阅未清理若涉及子系统通信，也归入此条**。
- **2.7.2 数据快照与缓存混用**：`nodes-data-store.ts` 中 `cacheChapterNodesData`（本地缓存）与 `chapterNodesData`（内存最新）职责不同，写入/读取路径不得交叉。
- **2.7.3 .wgt overrides 处理**：`WidgetInstance.overrides` 仅保存与模板差异部分，写入前必须经 `pickKnownProps` 过滤失效属性。
- **2.7.4 时间轴派生与临时态**：`EventTimelineAction.selected` 由 `applySelectedFlag` 派生，不得在业务代码手动维护；拖拽期间禁止 `setEditorData`，必须使用 `liveDragLayout` 临时态。
- **2.7.5 撤销栈合并**：连续同类操作（如属性拖拽、连续按键）必须使用 `mergeKey` 合并。
- **2.7.6 可达性算法一致性**：剧情树可达性计算须符合 `doc/剧情树可达性方案设计.md`（数值栈缓存链路变更），不得绕过栈机制直接读全局变量。
- **2.7.7 i18n 通道**：文案应走 `i18n-text.ts` / `localized_text_store.ts`，禁止散落硬编码（资源文件名、调试日志除外）。
- **2.7.8 条件编译与 Tauri 能力隔离**：
  - `#v-ifdef` / `#v-else` / `#v-endif` 必须配对
  - 需分别检查 editor / game / steam-game 三种目标下分支可达性是否完整覆盖
  - 同一逻辑若同时存在 `#v-ifdef` 与 `import.meta.env.VITE_GAME_MODE` 判断，二者条件必须一致
  - Steam 相关 `invoke` 仅在 `steam-game` 目标下可用
  - `@tauri-apps/plugin-*` 调用需在 `src-tauri/capabilities/default.json` 中授权
  - 编辑器目标下不得误用游戏专属能力

**附加检测点**：
- **工具散落**：公共工具应统一放 `lib/` 或 `components/Common/`，禁止在业务目录散落 `utils.ts`。
- **跨子系统能力调用**：编辑器目标下不得误用游戏专属能力（如运行时事件系统、存档系统）。
- **设计文档对齐**：任何与 `doc/` 下设计文档（`游戏架构设计.md`、`编辑器功能设计.md`、`剧情树可达性方案设计.md`）描述的流程/数据结构/状态机不一致的实现，均归入 ARCH。

**示例**：
```typescript
// ❌ 子系统直接 import 内部实现，绕过 eventBus$（违反 2.7.1）
// 文件：src/components/Game/system/audio-system/index.ts
import { playVideo } from "../story-system/videoPlayer"; // 应通过 eventBus$.next 触发

// ❌ 条件编译未配对（违反 2.7.8）
// #v-ifdef VITE_GAME_MODE == 1
import "./Game.css";
// 缺少 #v-endif

// ❌ 游戏侧用 create() 创建全局单例 store（违反 2.7.1 间接相关）
// 文件：src/components/Game/store.ts
export const useGameStore = create<GameState>(() => ({ ... })); // 多实例共享，污染
// 应：export const createGameStore = () => createStore<GameState>(() => ({ ... }));

// ❌ 时间轴拖拽直接落库（违反 2.7.4 / 2.7.5，双重违规归 ARCH）
// 文件：src/components/Editor/node-editor/timeline/widgets/timeline-toolbar.tsx
onDrag(layout) {
  eventStore.updateEvent({ ...action, layout });
  // 触发整树 re-render + 撤销栈污染
  // 应：setLiveDragLayout({ id, layout }); 落地时再 updateEvent 并传 mergeKey
}

// ❌ 手动维护 selected 字段（违反 2.7.4）
editorData.map(row =>
  row.actions.map(a => a.id === selectedId ? { ...a, selected: true } : a)
);
// 应通过 applySelectedFlag 派生

// ❌ overrides 未过滤直接写入（违反 2.7.3）
widget.overrides = newProps; // 可能包含模板已删除的属性
// 应：widget.overrides = pickKnownProps(widgetId, newProps);

// ❌ 数据快照与缓存混用（违反 2.7.2）
// 从 cacheChapterNodesData 读取后直接写回 chapterNodesData，或反之
const cached = cacheChapterNodesData.get(chapterId);
chapterNodesData.set(chapterId, cached); // 缓存与内存职责混淆

// ❌ 可达性算法绕过数值栈（违反 2.7.6）
function isReachable(nodeId, globalVars) {
  return globalVars.unlockedNodes.has(nodeId); // 直接读全局变量
}
// 应按 doc/剧情树可达性方案设计.md 的链路数值栈实现

// ❌ 硬编码中文文案（违反 2.7.7）
<Button>开始游戏</Button> // 应为 <Button>{t('startGame')}</Button>

// ❌ eventBus$ 订阅未清理且涉及子系统通信（违反 2.7.1，归 ARCH 而非 LEAK）
// 文件：src/components/Game/system/value-system/index.ts
useEffect(() => {
  eventBus$.subscribe((e) => handleValueChange(e)); // 跨子系统订阅未清理
  // 应：const sub = ...; return () => sub.unsubscribe();
}, []);
```
