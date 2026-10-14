# -*- coding: utf-8 -*-
"""
Knowledge_Lore_Router：Knowledge Intent → lore_requests（确定性映射）

来源：RAGFlow 画布「FTS游戏精灵0.5」节点 CodeExec:EarlyRingsCrash
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
    # 1. 基础工具
    # ============================================================

    def json_output(data):

        return json.dumps(
            data,
            ensure_ascii=False
        )


    def parse_json(value):

        if isinstance(value, dict):
            return value

        if not isinstance(value, str):
            return {}

        text = value.strip()

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


    # ============================================================
    # 2. Lore Catalog
    #
    # 这里保存的是：
    #
    # lore_key
    # → entity_id
    # → title
    #
    # 与 v0.2 Knowledge Base 保持一致。
    # ============================================================

    lore_catalog = {

        # --------------------------------------------------------
        # Gene System / Gameplay
        # --------------------------------------------------------

        "gene_system_overview": {
            "entity_id": "GS_GENE_SYSTEM",
            "title": "基因系统概述"
        },

        "gene_gameplay_collection": {
            "entity_id": "GS_GENE_COLLECTION",
            "title": "生物样本采集"
        },

        "gene_gameplay_collection_tools": {
            "entity_id": "UI_GENE_COLLECTION_TOOLS",
            "title": "扫描与采集工具操作"
        },

        "gene_gameplay_analysis": {
            "entity_id": "GS_GENE_SAMPLE_ANALYSIS",
            "title": "样本分析"
        },

        "gene_ui_analysis": {
            "entity_id": "UI_GENE_ANALYSIS",
            "title": "基因实验舱分析界面"
        },

        "gene_gameplay_sequencing": {
            "entity_id": "GS_GENE_SEQUENCING",
            "title": "基因测序与特征组合"
        },

        "gene_rule_chain_limit": {
            "entity_id": "RULE_GENE_CHAIN_LENGTH",
            "title": "基因链长度限制"
        },

        "gene_gameplay_blueprint": {
            "entity_id": "GS_GENE_BLUEPRINT",
            "title": "图谱保存与制作"
        },

        "gene_gameplay_serum": {
            "entity_id": "GS_GENE_SERUM",
            "title": "血清制作与临时体验"
        },

        "gene_gameplay_clone": {
            "entity_id": "GS_GENE_CLONE",
            "title": "克隆体制作与意识转移"
        },

        "gene_rule_appearance_gender": {
            "entity_id": "RULE_GENE_APPEARANCE_GENDER",
            "title": "基因外观性别选择"
        },

        "gene_ui_blueprint_compare": {
            "entity_id": "UI_GENE_BLUEPRINT_COMPARE",
            "title": "图谱对比"
        },

        "gene_rule_blueprint_export_trade": {
            "entity_id": "RULE_GENE_BLUEPRINT_EXPORT",
            "title": "图谱导出与交易"
        },


        # --------------------------------------------------------
        # Existing Gene Rule
        # --------------------------------------------------------

        "rule_gene_equipment_interaction": {
            "entity_id": "RULE001",
            "title": "基因替换与装备叠加规则"
        },


        # --------------------------------------------------------
        # Planets
        # --------------------------------------------------------

        "planet_pyra_01": {
            "entity_id": "PL001",
            "title": "赤曜火山星"
        },

        "planet_frost_ring_01": {
            "entity_id": "PL002",
            "title": "霜环星"
        },

        "planet_radiant_decay_01": {
            "entity_id": "PL003",
            "title": "辉蚀星"
        },

        "planet_green_ring_colony_01": {
            "entity_id": "PL004",
            "title": "翠环殖民地"
        },


        # --------------------------------------------------------
        # Creatures
        # --------------------------------------------------------

        "creature_lava_beetle": {
            "entity_id": "CR001",
            "title": "熔岩甲虫"
        },

        "creature_redscale_drake": {
            "entity_id": "CR002",
            "title": "赤甲龙蜥"
        },

        "creature_core_behemoth": {
            "entity_id": "CR003",
            "title": "焰核巨兽"
        },

        "creature_frost_ridge_ray": {
            "entity_id": "CR004",
            "title": "冰脊鳐"
        },

        "creature_radiant_stalker": {
            "entity_id": "CR005",
            "title": "辉蚀潜猎者"
        },

        "creature_void_horn_beast": {
            "entity_id": "CR006",
            "title": "虚空角兽"
        },


        # --------------------------------------------------------
        # Effects
        # --------------------------------------------------------

        "effect_energy_drain": {
            "entity_id": "EFFECT001",
            "title": "能量消耗增加"
        },

        "effect_health_regen": {
            "entity_id": "EFFECT002",
            "title": "生命恢复能力下降"
        },

        "effect_stamina_recovery": {
            "entity_id": "EFFECT003",
            "title": "体力恢复效率下降"
        },

        "effect_agility": {
            "entity_id": "EFFECT004",
            "title": "灵活性下降"
        }
    }


    # ============================================================
    # 3. Intent → Lore Mapping
    #
    # Knowledge Intent 不允许 LLM 直接生成 lore_key。
    # 这里只由 Code 确定性映射。
    # ============================================================

    intent_topic_map = {

        # --------------------------------------------------------
        # System
        # --------------------------------------------------------

        (
            "system_explain",
            "gene",
            "overview"
        ): [
            "gene_system_overview"
        ],


        # --------------------------------------------------------
        # Gameplay
        # --------------------------------------------------------

        (
            "gameplay_help",
            "gene",
            "collection"
        ): [
            "gene_gameplay_collection"
        ],

        (
            "gameplay_help",
            "gene",
            "collection_tools"
        ): [
            "gene_gameplay_collection_tools"
        ],

        (
            "gameplay_help",
            "gene",
            "analysis"
        ): [
            "gene_gameplay_analysis"
        ],

        (
            "gameplay_help",
            "gene",
            "sequencing"
        ): [
            "gene_gameplay_sequencing"
        ],

        (
            "gameplay_help",
            "gene",
            "blueprint"
        ): [
            "gene_gameplay_blueprint"
        ],

        (
            "gameplay_help",
            "gene",
            "serum"
        ): [
            "gene_gameplay_serum"
        ],

        (
            "gameplay_help",
            "gene",
            "clone"
        ): [
            "gene_gameplay_clone"
        ],


        # --------------------------------------------------------
        # UI
        # --------------------------------------------------------

        (
            "ui_help",
            "gene",
            "analysis"
        ): [
            "gene_ui_analysis"
        ],

        (
            "ui_help",
            "gene",
            "blueprint_compare"
        ): [
            "gene_ui_blueprint_compare"
        ],


        # --------------------------------------------------------
        # Rules
        # --------------------------------------------------------

        (
            "rule_explain",
            "gene",
            "chain_limit"
        ): [
            "gene_rule_chain_limit"
        ],

        (
            "rule_explain",
            "gene",
            "appearance_gender"
        ): [
            "gene_rule_appearance_gender"
        ],

        (
            "rule_explain",
            "gene",
            "export_trade"
        ): [
            "gene_rule_blueprint_export_trade"
        ],

        (
            "rule_explain",
            "gene",
            "gene_equipment_interaction"
        ): [
            "rule_gene_equipment_interaction"
        ]
    }


    # ============================================================
    # 4. Dynamic Entity Mappings
    # ============================================================

    planet_lore_map = {

        "PL001":
            "planet_pyra_01",

        "PL002":
            "planet_frost_ring_01",

        "PL003":
            "planet_radiant_decay_01",

        "PL004":
            "planet_green_ring_colony_01"
    }


    creature_lore_map = {

        "CR001":
            "creature_lava_beetle",

        "CR002":
            "creature_redscale_drake",

        "CR003":
            "creature_core_behemoth",

        "CR004":
            "creature_frost_ridge_ray",

        "CR005":
            "creature_radiant_stalker",

        "CR006":
            "creature_void_horn_beast"
    }


    effect_lore_map = {

        "energy_drain":
            "effect_energy_drain",

        "health_regen":
            "effect_health_regen",

        "stamina_recovery":
            "effect_stamina_recovery",

        "agility":
            "effect_agility"
    }


    # ============================================================
    # 5. Parse Intent
    # ============================================================

    intent_data = parse_json(
        intent_json
    )


    intent_family = intent_data.get(
        "intent_family"
    )


    intent = intent_data.get(
        "intent"
    )


    domain = intent_data.get(
        "domain"
    )


    topic = intent_data.get(
        "topic"
    )


    warnings = []


    # ============================================================
    # 6. Guard
    #
    # Knowledge_Lore_Router 只处理 Knowledge Intent。
    # ============================================================

    if intent_family != "knowledge":

        return json_output({

            "status":
                "ignored",

            "route":
                "knowledge",

            "intent_resolution":
                intent_data,

            "lore_requests":
                [],

            "lore_keys":
                [],

            "warnings": [
                "not_knowledge_intent"
            ]
        })


    selected_lore_keys = []


    # ============================================================
    # 7. Entity Info
    # ============================================================

    if intent == "entity_info":

        if topic == "planet":

            target_planet_id = intent_data.get(
                "target_planet_id"
            )


            lore_key = planet_lore_map.get(
                target_planet_id
            )


            if lore_key:

                selected_lore_keys.append(
                    lore_key
                )

            else:

                warnings.append(
                    "target_planet_not_resolved"
                )


        elif topic == "creature":

            target_creature_id = intent_data.get(
                "target_creature_id"
            )


            lore_key = creature_lore_map.get(
                target_creature_id
            )


            if lore_key:

                selected_lore_keys.append(
                    lore_key
                )

            else:

                warnings.append(
                    "target_creature_not_resolved"
                )


        else:

            warnings.append(
                "unsupported_entity_topic"
            )


    # ============================================================
    # 8. Effect Explain
    # ============================================================

    elif intent == "effect_explain":

        target_effect_type = intent_data.get(
            "target_effect_type"
        )


        lore_key = effect_lore_map.get(
            target_effect_type
        )


        if lore_key:

            selected_lore_keys.append(
                lore_key
            )

        else:

            warnings.append(
                "target_effect_not_resolved"
            )


    # ============================================================
    # 9. System / Gameplay / UI / Rule
    # ============================================================

    else:

        route_key = (

            intent,
            domain,
            topic
        )


        mapped_keys = intent_topic_map.get(
            route_key,
            []
        )


        if mapped_keys:

            selected_lore_keys.extend(
                mapped_keys
            )

        else:

            warnings.append(
                "knowledge_route_not_found"
            )


    # ============================================================
    # 10. 去重
    # ============================================================

    unique_lore_keys = []

    seen = set()


    for lore_key in selected_lore_keys:

        if lore_key in seen:
            continue

        seen.add(
            lore_key
        )

        unique_lore_keys.append(
            lore_key
        )


    # ============================================================
    # 11. Build Lore Requests
    #
    # 输出格式与 Decision 路径中的 lore_requests
    # 尽量保持一致。
    # ============================================================

    lore_requests = []


    for index, lore_key in enumerate(
        unique_lore_keys
    ):

        metadata = lore_catalog.get(
            lore_key,
            {}
        )


        lore_requests.append({

            "lore_key":
                lore_key,

            "reason":
                "knowledge_intent",

            "priority":
                100 - index,

            "entity_id":
                metadata.get(
                    "entity_id"
                ),

            "title":
                metadata.get(
                    "title"
                )
        })


    # ============================================================
    # 12. Status
    # ============================================================

    if lore_requests:

        status = "success"

    else:

        status = "needs_clarification"


    # ============================================================
    # 13. Final Result
    # ============================================================

    result = {

        "status":
            status,

        "route":
            "knowledge",

        "intent_resolution":
            intent_data,

        "lore_requests":
            lore_requests,

        "lore_keys":
            unique_lore_keys,

        "warnings":
            warnings
    }


    return json_output(
        result
    )
