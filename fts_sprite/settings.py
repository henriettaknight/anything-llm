# -*- coding: utf-8 -*-
"""
FTS 精灵服务配置。

所有外部服务配置都来自环境变量（与 AnythingLLM 共用 server/.env），
统一以 FTS_SPRITE_ 前缀命名，避免与智能翻译的 RAGFLOW_* 冲突。

加载顺序：
  1. 进程环境变量（Docker 下由 docker-compose 的 env_file 注入）
  2. .env 文件：默认 server/.env；本地开发（dev.sh）依次读 server/.env.development、server/.env
  进程环境变量优先，.env 只补充缺失项。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROMPTS_DIR = BASE_DIR / "prompts"


def _read_text_any_encoding(path: Path) -> str:
    """
    读取 .env 文本。优先 UTF-8；在 Windows 编辑器里保存过的文件可能是 GBK，
    这类文件 Node 的 dotenv 能容忍，Python 的 dotenv 会直接报 UnicodeDecodeError。
    中文通常只出现在注释里，所以最后用 replace 兜底也不会影响变量值。
    """
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "gbk"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _env_files() -> list[Path]:
    """
    要加载的 .env 文件列表，排在前面的优先（override=False，先加载的值不会被覆盖）。

    FTS_SPRITE_ENV_FILE 可指定一个或多个文件（用 os.pathsep 分隔，Linux 为 ":"）。
    未指定时只读 server/.env（Docker / 生产）。
    本地开发由 dev.sh 指定 server/.env.development + server/.env，
    与 Node 开发模式（NODE_ENV=development 只读 .env.development）保持一致。
    """
    raw = os.getenv("FTS_SPRITE_ENV_FILE")
    if raw:
        return [Path(p) for p in raw.split(os.pathsep) if p.strip()]
    return [BASE_DIR.parent / "server" / ".env"]


def _load_env_file() -> None:
    try:
        import io

        from dotenv import load_dotenv
    except ImportError:  # python-dotenv 未安装时静默跳过
        return
    for env_file in _env_files():
        if env_file.is_file():
            load_dotenv(stream=io.StringIO(_read_text_any_encoding(env_file)), override=False)


_load_env_file()


def _str(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().strip('"').strip("'")


def _float(name: str, default: float) -> float:
    try:
        return float(_str(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(float(_str(name, str(default))))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    value = _str(name, "")
    if not value:
        return default
    return value.lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class LLMRoleConfig:
    """
    中间 LLM 角色配置。

    选择规则（按优先级）：
      1. 配置了 BASE_URL      → Python 直连 OpenAI 兼容接口（vLLM / Ollama /v1 / OpenAI）
      2. 配置了 PROVIDER/MODEL → 经 Node LLM 网关，使用指定 provider / model
      3. 都未配置（默认）       → 经 Node LLM 网关，使用 workspace 设置里的模型
    """

    role: str
    base_url: str = ""
    api_key: str = ""
    provider: str = ""
    model: str = ""
    temperature: float = 0.1
    top_p: float | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    max_retries: int = 3
    retry_delay: float = 1.0
    timeout: float = 120.0

    @property
    def mode(self) -> str:
        return "direct" if self.base_url else "gateway"

    @classmethod
    def from_env(cls, role: str, **defaults) -> "LLMRoleConfig":
        p = f"FTS_SPRITE_LLM_{role.upper()}_"

        def opt_float(key: str, default):
            raw = _str(p + key, "")
            if raw == "":
                return default
            try:
                return float(raw)
            except ValueError:
                return default

        return cls(
            role=role,
            base_url=_str(p + "BASE_URL").rstrip("/"),
            api_key=_str(p + "API_KEY"),
            provider=_str(p + "PROVIDER"),
            model=_str(p + "MODEL"),
            temperature=opt_float("TEMPERATURE", defaults.get("temperature", 0.1)),
            top_p=opt_float("TOP_P", defaults.get("top_p")),
            frequency_penalty=opt_float("FREQUENCY_PENALTY", defaults.get("frequency_penalty")),
            presence_penalty=opt_float("PRESENCE_PENALTY", defaults.get("presence_penalty")),
            max_retries=_int(p + "MAX_RETRIES", defaults.get("max_retries", 3)),
            retry_delay=opt_float("RETRY_DELAY", defaults.get("retry_delay", 1.0)),
            timeout=opt_float("TIMEOUT", defaults.get("timeout", 120.0)),
        )

    def describe(self) -> dict:
        """供 /health 展示，不含密钥。"""
        return {
            "mode": self.mode,
            "base_url": self.base_url or None,
            "provider": self.provider or "(workspace)",
            "model": self.model or "(workspace)",
            "temperature": self.temperature,
        }


@dataclass(frozen=True)
class Settings:
    host: str = field(default_factory=lambda: _str("FTS_SPRITE_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: _int("FTS_SPRITE_PORT", 8890))

    # ---------------- RAGFlow（Sprite AI Lore Knowledge Base） ----------------
    ragflow_base_url: str = field(
        default_factory=lambda: _str("FTS_SPRITE_RAGFLOW_BASE_URL").rstrip("/")
    )
    ragflow_api_key: str = field(default_factory=lambda: _str("FTS_SPRITE_RAGFLOW_API_KEY"))
    ragflow_dataset_id: str = field(default_factory=lambda: _str("FTS_SPRITE_RAGFLOW_DATASET_ID"))
    # 与画布 Retrieval 节点一致：top_n=1, top_k=1024, similarity_threshold=0.3,
    # keywords_similarity_weight=0.3（即 vector_similarity_weight=0.7）
    ragflow_top_n: int = field(default_factory=lambda: _int("FTS_SPRITE_RAGFLOW_TOP_N", 1))
    ragflow_top_k: int = field(default_factory=lambda: _int("FTS_SPRITE_RAGFLOW_TOP_K", 1024))
    ragflow_similarity_threshold: float = field(
        default_factory=lambda: _float("FTS_SPRITE_RAGFLOW_SIMILARITY_THRESHOLD", 0.3)
    )
    ragflow_vector_similarity_weight: float = field(
        default_factory=lambda: _float("FTS_SPRITE_RAGFLOW_VECTOR_SIMILARITY_WEIGHT", 0.7)
    )
    ragflow_timeout: float = field(default_factory=lambda: _float("FTS_SPRITE_RAGFLOW_TIMEOUT", 30))

    # ---------------- Mock Game Server ----------------
    mock_server_url: str = field(
        default_factory=lambda: _str("FTS_SPRITE_MOCK_SERVER_URL").rstrip("/")
    )
    mock_api_key: str = field(default_factory=lambda: _str("FTS_SPRITE_MOCK_API_KEY"))
    # MOCK_API_KEY 为空时不发送认证 Header；不为空时发送 <HEADER>: <PREFIX><KEY>
    mock_api_key_header: str = field(
        default_factory=lambda: _str("FTS_SPRITE_MOCK_API_KEY_HEADER", "Authorization")
    )
    mock_api_key_prefix: str = field(
        default_factory=lambda: os.getenv("FTS_SPRITE_MOCK_API_KEY_PREFIX", "Bearer ")
    )
    mock_timeout: float = field(default_factory=lambda: _float("FTS_SPRITE_MOCK_TIMEOUT", 30))

    # 当前 Demo 玩家
    player_id: str = field(default_factory=lambda: _str("FTS_SPRITE_PLAYER_ID", "P001"))

    # 意图识别使用的历史消息条数（画布 message_history_window_size=12）
    intent_history_messages: int = field(
        default_factory=lambda: _int("FTS_SPRITE_INTENT_HISTORY_MESSAGES", 12)
    )

    # 线程池大小（执行人工编写的同步 Python 代码）
    worker_threads: int = field(default_factory=lambda: _int("FTS_SPRITE_WORKER_THREADS", 8))

    log_level: str = field(default_factory=lambda: _str("FTS_SPRITE_LOG_LEVEL", "INFO"))

    # 中间 LLM 角色；默认值与画布 Intent Resolver 节点一致
    llm_intent: LLMRoleConfig = field(
        default_factory=lambda: LLMRoleConfig.from_env(
            "intent",
            temperature=0.1,
            top_p=0.3,
            frequency_penalty=0.7,
            presence_penalty=0.4,
            max_retries=3,
            retry_delay=1.0,
        )
    )

    def describe(self) -> dict:
        return {
            "ragflow": {
                "base_url": self.ragflow_base_url or None,
                "dataset_id": self.ragflow_dataset_id or None,
                "api_key_set": bool(self.ragflow_api_key),
                "top_n": self.ragflow_top_n,
                "similarity_threshold": self.ragflow_similarity_threshold,
            },
            "mock_server": {
                "url": self.mock_server_url or None,
                "api_key_set": bool(self.mock_api_key),
            },
            "player_id": self.player_id,
            "llm": {"intent": self.llm_intent.describe()},
        }


settings = Settings()
