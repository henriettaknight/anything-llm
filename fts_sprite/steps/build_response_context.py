# -*- coding: utf-8 -*-
"""
Build_Response_Context：组装给主 LLM 的 RESPONSE CONTEXT

来源：RAGFlow 画布「FTS游戏精灵0.5」节点 CodeExec:MajorMoonsBuy
本文件的 main() 与画布 Code 节点脚本保持一致（逐字迁移），
后续在 RAGFlow 中调整脚本时，可直接整体替换 main() 函数。
请勿在 main() 内加入 print：日志请使用 logging。
"""

import json
import re


def main(
    intent_json: str,
    decision_context_json: str,
    knowledge_context_json: str
) -> str:

    # ============================================================
    # 1. 工具
    # ============================================================

    def parse_json(value):

        if isinstance(value, dict):
            return value

        if not isinstance(value, str):
            return {}

        text = value.strip()

        if not text:
            return {}

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


    def json_output(data):

        return json.dumps(
            data,
            ensure_ascii=False
        )


    # ============================================================
    # 2. Parse
    # ============================================================

    intent_data = parse_json(
        intent_json
    )

    decision_context = parse_json(
        decision_context_json
    )

    knowledge_context = parse_json(
        knowledge_context_json
    )


    intent_family = intent_data.get(
        "intent_family",
        "unknown"
    )


    # ============================================================
    # 3. Decision Response Context
    # ============================================================

    if intent_family == "decision":

        result = {

            "response_mode":
                "decision",

            "intent_resolution":
                decision_context.get(
                    "intent_resolution",
                    intent_data
                ),

            "player_state":
                decision_context.get(
                    "player_state",
                    {}
                ),

            "target_context":
                decision_context.get(
                    "target_context",
                    {}
                ),

            "decision":
                decision_context.get(
                    "decision",
                    {}
                ),

            "decision_options":
                decision_context.get(
                    "decision_options",
                    []
                )
        }


        return json_output(
            result
        )


    # ============================================================
    # 4. Knowledge Response Context
    # ============================================================

    if intent_family == "knowledge":

        result = {

            "response_mode":
                "knowledge",

            "intent_resolution":
                knowledge_context.get(
                    "intent_resolution",
                    intent_data
                )
        }


        return json_output(
            result
        )


    # ============================================================
    # 5. Unknown
    # ============================================================

    return json_output({

        "response_mode":
            "unknown",

        "intent_resolution":
            intent_data
    })
