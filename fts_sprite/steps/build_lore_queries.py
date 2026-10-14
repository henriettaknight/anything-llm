# -*- coding: utf-8 -*-
"""
Build_Lore_Queries：合并 lore_requests → 每个 lore 一条检索 Query

来源：RAGFlow 画布「FTS游戏精灵0.5」节点 CodeExec:PetiteViewsWear
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
):

    # ============================================================
    # 1. 基础工具
    # ============================================================

    def parse_json(value):

        if isinstance(value, dict):
            return value

        if not isinstance(value, str):
            return {}

        text = value.strip()

        if not text:
            return {}

        # 兼容 ```json ... ```
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

            data = json.loads(
                text
            )

            if isinstance(
                data,
                dict
            ):
                return data

        except Exception:
            pass

        return {}


    def as_lore_requests(context):

        if not isinstance(
            context,
            dict
        ):
            return []

        requests = context.get(
            "lore_requests",
            []
        )

        if not isinstance(
            requests,
            list
        ):
            return []

        return [
            item
            for item in requests
            if isinstance(
                item,
                dict
            )
        ]


    # ============================================================
    # 2. 解析三个上游 Context
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
        "intent_family"
    )


    # ============================================================
    # 3. 根据 Intent Family 选择 Lore 来源
    #
    # 当前版本：
    #
    # decision
    # → Option_Selection
    #
    # knowledge
    # → Knowledge_Lore_Router
    #
    # 同时保留 fallback / future mixed 支持。
    # ============================================================

    source_requests = []


    if intent_family == "decision":

        source_requests.extend(
            as_lore_requests(
                decision_context
            )
        )


    elif intent_family == "knowledge":

        source_requests.extend(
            as_lore_requests(
                knowledge_context
            )
        )


    else:

        # --------------------------------------------------------
        # fallback
        #
        # 如果以后增加 mixed，
        # 或 intent_family 异常，
        # 尝试把两个来源一起读取。
        # --------------------------------------------------------

        source_requests.extend(
            as_lore_requests(
                decision_context
            )
        )

        source_requests.extend(
            as_lore_requests(
                knowledge_context
            )
        )


    # ============================================================
    # 4. lore_key 去重
    #
    # 如果同一个 lore_key 从多个来源出现：
    #
    # - 保留 priority 更高的
    # - 如果 priority 相同，优先保留信息更完整的
    # ============================================================

    merged_by_key = {}


    for item in source_requests:

        lore_key = item.get(
            "lore_key"
        )


        if not lore_key:
            continue


        lore_key = str(
            lore_key
        ).strip()


        if not lore_key:
            continue


        current_priority = item.get(
            "priority",
            0
        )


        try:

            current_priority = int(
                current_priority
            )

        except Exception:

            current_priority = 0


        normalized = {

            "lore_key":
                lore_key,

            "reason":
                item.get(
                    "reason"
                ),

            "priority":
                current_priority,

            "entity_id":
                item.get(
                    "entity_id"
                ),

            "title":
                item.get(
                    "title"
                )
        }


        existing = merged_by_key.get(
            lore_key
        )


        if existing is None:

            merged_by_key[
                lore_key
            ] = normalized

            continue


        existing_priority = existing.get(
            "priority",
            0
        )


        # --------------------------------------------------------
        # priority 更高 → 替换
        # --------------------------------------------------------

        if current_priority > existing_priority:

            merged_by_key[
                lore_key
            ] = normalized

            continue


        # --------------------------------------------------------
        # priority 一样时，
        # 用当前值补齐缺失 metadata
        # --------------------------------------------------------

        if current_priority == existing_priority:

            if (
                not existing.get(
                    "title"
                )
                and normalized.get(
                    "title"
                )
            ):

                existing[
                    "title"
                ] = normalized.get(
                    "title"
                )


            if (
                not existing.get(
                    "entity_id"
                )
                and normalized.get(
                    "entity_id"
                )
            ):

                existing[
                    "entity_id"
                ] = normalized.get(
                    "entity_id"
                )


            if (
                not existing.get(
                    "reason"
                )
                and normalized.get(
                    "reason"
                )
            ):

                existing[
                    "reason"
                ] = normalized.get(
                    "reason"
                )


    # ============================================================
    # 5. 按 Priority 排序
    #
    # priority 高的知识优先检索。
    # ============================================================

    merged_requests = sorted(

        merged_by_key.values(),

        key=lambda item: (
            -item.get(
                "priority",
                0
            ),
            item.get(
                "lore_key",
                ""
            )
        )
    )


    # ============================================================
    # 6. 每个 Lore Request 独立生成一个 Retrieval Query
    #
    # 仍保持：
    #
    # Array<String>
    #
    # 兼容你现在已经测试通过的 Iteration。
    #
    # Query 的第一个 token 必须保持为 lore_key，
    # 因为 Merge_Lore_Result 当前会通过第一个 token
    # 取得 requested_lore_key。
    # ============================================================

    queries = []


    for item in merged_requests:

        lore_key = item.get(
            "lore_key"
        )

        title = item.get(
            "title"
        )

        entity_id = item.get(
            "entity_id"
        )


        query_parts = [
            lore_key
        ]


        if title:

            query_parts.append(
                str(
                    title
                ).strip()
            )


        if entity_id:

            query_parts.append(
                str(
                    entity_id
                ).strip()
            )


        query = " ".join(
            part
            for part in query_parts
            if part
        )


        queries.append(
            query
        )


    # ============================================================
    # 7. 输出 Array<String>
    #
    # 示例：
    #
    # [
    #   "planet_pyra_01 赤曜火山星 PL001",
    #   "effect_energy_drain 能量消耗增加 EFFECT001"
    # ]
    # ============================================================

    return queries
