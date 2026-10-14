# FTS 精灵 Python 服务（fts_sprite）

把 RAGFlow 画布「FTS游戏精灵0.5」迁移成常驻 Python 服务，与 AnythingLLM 的 `server`、`collector` 一起运行在同一个容器里。

## 一次问答的流程

```
前端 ──SSE──► Node /workspace/:slug/stream-chat
                │ 命中 FTS 精灵 workspace（名称 "FTS精灵" 或 slug "fts_sprite"）
                │ POST http://127.0.0.1:8890/workflow/run（NDJSON）
                ▼
        fts_sprite（本服务）
          1. 并发请求 Mock Game Server 的 7 个接口
          2. 意图识别 LLM（只等待 missions / planets）
          3. 路由
             decision : 决策上下文 → 发现程度过滤 → 方案筛选
             knowledge: Lore 路由（取消剩余的游戏数据请求）
             unknown  : 固定回复
          4. 每个 lore_key 并发检索 RAGFlow，按优先级合并
          5. 组装 RESPONSE CONTEXT，返回主 LLM 的 system / user 提示词
                │
                ▼
        Node：streamChatWithWorkspace → 主 LLM 流式回答
              → 落库（只保存玩家问题 + 最终回答）
```

中间 LLM 调用 Node 的网关 `/api/fts_sprite/internal/llm`，默认使用 workspace 设置里选的模型。网关使用一次性 token，请求结束后即失效。

## 目录

| 路径 | 说明 |
|---|---|
| `main.py` | FastAPI 入口：`/health`、`/workflow/run` |
| `settings.py` | 读取环境变量（`FTS_SPRITE_*`），也会读取 `../server/.env` |
| `workflow/runner.py` | 编排：顺序执行 + 并行点 |
| `workflow/prompts.py` | 加载、渲染 `prompts/*.md` |
| `steps/*.py` | 画布 Code 节点的**逐字迁移**，每个文件一个 `main()` |
| `clients/` | LLM（网关 / 直连）、RAGFlow、Mock Game Server 客户端 |
| `prompts/` | 意图识别和主 LLM 的提示词，以及 unknown 时的固定回复 |
| `tests/` | 用模拟服务跑通三条路径，并对比画布的串行结果 |

画布节点与文件的对应关系：

| 画布节点 | 文件 |
|---|---|
| Invoke ×7 | `clients/game_server.py`（改为并发） |
| Agent:LuckyMailsLike（Intent Resolver） | `prompts/intent_*.md` + `clients/llm.py` |
| CodeExec:LegalPearsWave | `steps/route_intent.py` |
| CodeExec:ShinySidesSell（Build_Decision_Context） | `steps/build_decision_context.py` |
| CodeExec:EveryFalconsBattle（Knowledge_Scope_Filter） | `steps/knowledge_scope_filter.py` |
| CodeExec:UpsetMelonsSmoke（Option_Selection） | `steps/option_selection.py` |
| CodeExec:EarlyRingsCrash（Knowledge_Lore_Router） | `steps/knowledge_lore_router.py` |
| CodeExec:PetiteViewsWear | `steps/build_lore_queries.py` |
| Retrieval:MetalBerriesSell | `clients/ragflow.py`（改为并发） |
| CodeExec:TidyWingsPlay（Merge_Lore_Result） | `steps/merge_lore_result.py` |
| CodeExec:MajorMoonsBuy | `steps/build_response_context.py` |
| Message:MajorTiesAdd | `prompts/unknown_reply.md` |
| Agent:RichWebsRun（Sprite Response） | `prompts/response_*.md`，由 Node 主流程调用 |

在 RAGFlow 里修改了某个 Code 节点后，把新脚本的 `main()` 整体替换到对应的 `steps/*.py` 里即可。

## 配置（server/.env）

```env
# RAGFlow：Sprite AI Lore Knowledge Base
FTS_SPRITE_RAGFLOW_BASE_URL=""
FTS_SPRITE_RAGFLOW_API_KEY=""
FTS_SPRITE_RAGFLOW_DATASET_ID=""

# Mock Game Server
FTS_SPRITE_MOCK_SERVER_URL=""
FTS_SPRITE_MOCK_API_KEY=""                      # 为空时不发送认证 Header
# FTS_SPRITE_MOCK_API_KEY_HEADER="Authorization"
# FTS_SPRITE_MOCK_API_KEY_PREFIX="Bearer "

# 当前 Demo 玩家
FTS_SPRITE_PLAYER_ID="P001"
```

其余可选项（端口、检索参数、中间 LLM 单独配置等）见 `server/.env.example` 中 FTS 精灵配置段。

## 本地开发

在仓库根目录运行 `yarn dev:all`，会把精灵服务和 server、frontend、collector 一起启动。也可以用 `yarn dev:fts_sprite` 单独启动它。

`dev.sh` 的行为：

- 第一次运行时，在 `~/.venvs/fts_sprite` 创建独立的虚拟环境并安装依赖，不会改动当前激活的 conda 或系统 Python 里的包。不放在仓库目录里，是因为 NTFS/exFAT 盘或网络共享上可能无法创建虚拟环境需要的符号链接。可以用 `FTS_SPRITE_VENV` 换位置；
- 虚拟环境损坏时（比如上次只建了一半）会自动重建；
- `requirements.txt` 有变化时会自动重新安装；
- 以热重载方式启动 `uvicorn`，地址是 127.0.0.1:8890。

默认用 `python3` 创建虚拟环境，可以用 `FTS_SPRITE_PYTHON` 指定其他 Python。

运行测试：

```bash
~/.venvs/fts_sprite/bin/pip install pytest
~/.venvs/fts_sprite/bin/python -m pytest -q tests
```

## 检查 Mock Game Server

不需要 LLM 和 RAGFlow，也不需要启动精灵服务：

```bash
~/.venvs/fts_sprite/bin/python fts_sprite/scripts/check_game_server.py               # 当前任务
~/.venvs/fts_sprite/bin/python fts_sprite/scripts/check_game_server.py --planet PL001
~/.venvs/fts_sprite/bin/python fts_sprite/scripts/check_game_server.py --mission MS002 --show-context
```

脚本会逐个请求 7 个接口，显示状态、耗时、条数和示例 ID；检查 Demo 玩家是否存在；再用真实数据离线跑一遍决策代码。
