# -*- coding: utf-8 -*-
"""
提示词加载与渲染。

提示词原文保存在 fts_sprite/prompts/*.md（从画布 Agent 节点迁移），
占位符使用 {{name}}，避免与提示词中的 JSON 花括号冲突。
文件在服务启动时读取一次；修改提示词后重启服务即可生效。
"""

from __future__ import annotations

from functools import lru_cache

from settings import PROMPTS_DIR


@lru_cache(maxsize=None)
def load(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def render(name: str, **values: str) -> str:
    text = load(name)
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", "" if value is None else str(value))
    return text


def intent_messages(
    query: str,
    missions: str,
    planets: str,
    history: list[dict],
    player_context: str = "{}",
    creatures: str = "[]",
) -> list[dict]:
    """
    Intent Resolver（画布 Agent:LuckyMailsLike）：system + 历史 + 本轮 user。

    相比画布额外提供 player_context（当前星球 / 当前任务）和 creatures（生物列表），
    用于解析“这个动物”“这里”等指代。
    """
    return [
        {"role": "system", "content": load("intent_system")},
        *history,
        {
            "role": "user",
            "content": render(
                "intent_user",
                query=query,
                missions=missions,
                planets=planets,
                player_context=player_context,
                creatures=creatures,
            ),
        },
    ]


def response_system() -> str:
    """Sprite Response（画布 Agent:RichWebsRun）系统提示词，由 Node 主流程使用。"""
    return load("response_system")


def response_user(query: str, response_context: str, lore_context: str) -> str:
    return render(
        "response_user",
        query=query,
        response_context=response_context,
        lore_context=lore_context,
    )


def unknown_reply() -> str:
    """画布 Message:MajorTiesAdd：意图无法识别时的固定回复。"""
    return load("unknown_reply").strip()
