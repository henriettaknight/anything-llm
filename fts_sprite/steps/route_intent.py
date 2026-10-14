# -*- coding: utf-8 -*-
"""
Intent 路由：输出 decision / knowledge / unknown

来源：RAGFlow 画布「FTS游戏精灵0.5」节点 CodeExec:LegalPearsWave
本文件的 main() 与画布 Code 节点脚本保持一致（逐字迁移），
后续在 RAGFlow 中调整脚本时，可直接整体替换 main() 函数。
请勿在 main() 内加入 print：日志请使用 logging。
"""

import json
import re


def main(
    intent_json: str
) -> str:

    # ============================================================
    # 1. JSON 解析
    # ============================================================

    def parse_json(value):

        if isinstance(value, dict):
            return value

        if not isinstance(value, str):
            return {}

        text = value.strip()

        # 兼容 LLM 偶尔返回 ```json ... ```
        text = re.sub(
            r"^```(?:json)?\s*",
            "",
            text,
            flags=re.IGNORECASE
        )

        text = re.sub(
            r"\s*```$",
            "",
            text
        )

        try:
            data = json.loads(text)

            if isinstance(data, dict):
                return data

        except Exception:
            pass

        return {}


    intent_data = parse_json(
        intent_json
    )


    # ============================================================
    # 2. 优先读取新版 intent_family
    # ============================================================

    intent_family = intent_data.get(
        "intent_family"
    )


    if intent_family in (
        "decision",
        "knowledge",
        "unknown"
    ):

        return intent_family


    # ============================================================
    # 3. 兼容旧版 Intent Resolver
    #
    # 在升级期间，如果偶尔收到没有 intent_family 的旧结构，
    # 仍可根据 intent 推断路由。
    # ============================================================

    intent = intent_data.get(
        "intent"
    )


    decision_intents = {
        "current_mission_preparation",
        "mission_preparation",
        "planet_preparation",
        "gene_upgrade"
    }


    knowledge_intents = {
        "system_explain",
        "gameplay_help",
        "ui_help",
        "rule_explain",
        "entity_info",
        "effect_explain"
    }


    if intent in decision_intents:
        return "decision"


    if intent in knowledge_intents:
        return "knowledge"


    return "unknown"
