# -*- coding: utf-8 -*-
"""
Knowledge_Scope_Filter：按玩家已发现程度过滤可见信息

来源：RAGFlow 画布「FTS游戏精灵0.5」节点 CodeExec:EveryFalconsBattle
本文件的 main() 与画布 Code 节点脚本保持一致（逐字迁移），
后续在 RAGFlow 中调整脚本时，可直接整体替换 main() 函数。
请勿在 main() 内加入 print：日志请使用 logging。
"""

import json


def main(
    decision_context_json: str
) -> str:

    # ============================================================
    # 1. 基础工具
    # ============================================================

    def json_output(data):
        return json.dumps(
            data,
            ensure_ascii=False
        )


    def to_number(value, default=0):
        try:
            return float(value)
        except Exception:
            return default


    def to_bool(value, default=False):

        if isinstance(value, bool):
            return value

        if isinstance(value, str):

            text = value.strip().lower()

            if text == "true":
                return True

            if text == "false":
                return False

        if value is None:
            return default

        return bool(value)


    # ============================================================
    # 2. 解析 Build_Decision_Context
    # ============================================================

    try:

        context = json.loads(
            decision_context_json
        )

    except Exception:

        return json_output({
            "status":
                "error",

            "error_code":
                "INVALID_DECISION_CONTEXT",

            "message":
                "Decision context is not valid JSON."
        })


    if not isinstance(
        context,
        dict
    ):

        return json_output({
            "status":
                "error",

            "error_code":
                "INVALID_DECISION_CONTEXT",

            "message":
                "Decision context must be an object."
        })


    # ============================================================
    # 3. Knowledge Scope
    # ============================================================

    if "knowledge_scope" not in context:

        return json_output({
            "status":
                "error",

            "error_code":
                "KNOWLEDGE_SCOPE_MISSING",

            "message":
                "Decision context does not contain knowledge_scope."
        })


    knowledge_scope = context.get(
        "knowledge_scope"
    )


    if not isinstance(
        knowledge_scope,
        dict
    ):

        return json_output({
            "status":
                "error",

            "error_code":
                "INVALID_KNOWLEDGE_SCOPE",

            "message":
                "knowledge_scope must be an object."
        })


    allow_undiscovered_entity_details = (
        to_bool(
            knowledge_scope.get(
                "allow_undiscovered_entity_details"
            ),
            False
        )
    )


    creature_state_by_id = (
        knowledge_scope.get(
            "creature_state_by_id",
            {}
        )
    )


    if not isinstance(
        creature_state_by_id,
        dict
    ):
        creature_state_by_id = {}


    scanned_raw = (
        knowledge_scope.get(
            "scanned_creature_ids",
            []
        )
    )


    if not isinstance(
        scanned_raw,
        list
    ):
        scanned_raw = []


    scanned_creature_ids = set(
        scanned_raw
    )


    # ============================================================
    # Creature Disclosure Rule
    #
    # unknown / encountered
    #     不允许披露正式名称、Gene 来源、Lore 详情
    #
    # scanned / sampled / analyzed
    #     允许披露 Creature 详细信息
    #
    # 当前 v0.1 的披露阈值：
    #
    # scanned
    # ============================================================

    def creature_details_allowed(
        creature_id
    ):

        if not creature_id:
            return False

        if allow_undiscovered_entity_details:
            return True

        return (
            creature_id
            in scanned_creature_ids
        )


    def get_creature_state(
        creature_id
    ):

        if not creature_id:
            return None

        return (
            creature_state_by_id.get(
                creature_id,
                "unknown"
            )
        )


    # ============================================================
    # 4. 原始数据
    # ============================================================

    raw_gene_candidates = (
        context.get(
            "gene_candidates",
            []
        )
    )

    if not isinstance(
        raw_gene_candidates,
        list
    ):
        raw_gene_candidates = []


    raw_excluded_gene_candidates = (
        context.get(
            "excluded_gene_candidates",
            []
        )
    )

    if not isinstance(
        raw_excluded_gene_candidates,
        list
    ):
        raw_excluded_gene_candidates = []


    raw_equipment_candidates = (
        context.get(
            "equipment_candidates",
            []
        )
    )

    if not isinstance(
        raw_equipment_candidates,
        list
    ):
        raw_equipment_candidates = []


    raw_calculated_options = (
        context.get(
            "calculated_options",
            []
        )
    )

    if not isinstance(
        raw_calculated_options,
        list
    ):
        raw_calculated_options = []


    raw_lore_requests = (
        context.get(
            "lore_requests",
            []
        )
    )

    if not isinstance(
        raw_lore_requests,
        list
    ):
        raw_lore_requests = []


    # ============================================================
    # 5. Gene Candidate Knowledge Filter
    #
    # 当前阶段：
    #
    # source_species_id 存在：
    #   来源 Creature 至少 scanned 才允许进入决策。
    #
    # source_species_id 不存在：
    #   暂不受 Creature Discovery 限制。
    #
    # stock / available / improvement 等判断仍由
    # Build_Decision_Context 负责。
    # ============================================================

    def gene_is_visible(
        gene
    ):

        if not isinstance(
            gene,
            dict
        ):
            return False


        source_species_id = (
            gene.get(
                "source_species_id"
            )
        )


        if not source_species_id:
            return True


        return creature_details_allowed(
            source_species_id
        )


    visible_gene_candidates = []

    visible_gene_ids = set()

    visible_source_species_ids = set()

    visible_side_effect_types = set()


    for gene in raw_gene_candidates:

        if not gene_is_visible(
            gene
        ):
            continue


        visible_gene = dict(
            gene
        )


        visible_gene_candidates.append(
            visible_gene
        )


        gene_id = visible_gene.get(
            "gene_id"
        )


        if gene_id:

            visible_gene_ids.add(
                gene_id
            )


        source_species_id = (
            visible_gene.get(
                "source_species_id"
            )
        )


        if source_species_id:

            visible_source_species_ids.add(
                source_species_id
            )


        side_effect_type = (
            visible_gene.get(
                "side_effect_type"
            )
        )


        if (
            side_effect_type
            and side_effect_type != "none"
        ):

            visible_side_effect_types.add(
                side_effect_type
            )


    # ============================================================
    # 6. Excluded Gene Candidates
    #
    # Debug 数据同样不能泄露未知 Creature。
    # ============================================================

    visible_excluded_gene_candidates = []


    for gene in raw_excluded_gene_candidates:

        if not gene_is_visible(
            gene
        ):
            continue


        visible_excluded_gene_candidates.append(
            dict(
                gene
            )
        )


    # ============================================================
    # 7. Calculated Options Knowledge Filter
    #
    # 保留：
    #
    # current
    # equipment_only
    # visible gene_only
    # visible gene_plus_equipment
    #
    # 如果 Option 使用了不可见 Gene：
    # Fail Closed，直接过滤。
    # ============================================================

    visible_calculated_options = []


    for option in raw_calculated_options:

        if not isinstance(
            option,
            dict
        ):
            continue


        gene_id = option.get(
            "gene_id"
        )


        if (
            gene_id
            and gene_id
            not in visible_gene_ids
        ):
            continue


        visible_calculated_options.append(
            dict(
                option
            )
        )

    # ============================================================
    # 当前 Knowledge Scope 下是否真的存在 Gene / Equipment 方案
    # ============================================================

    visible_has_gene_option = any(

        isinstance(option, dict)
        and option.get("gene_id")

        for option
        in visible_calculated_options
    )


    visible_has_equipment_option = any(

        isinstance(option, dict)
        and option.get("equipment_id")

        for option
        in visible_calculated_options
    )

    # ============================================================
    # 8. Target Context Disclosure Filter
    #
    # target_creature_id：
    # 保留给内部规则使用。
    #
    # target_creature_name：
    # 未达到 scanned 时必须删除。
    # ============================================================

    raw_target_context = (
        context.get(
            "target_context",
            {}
        )
    )


    if not isinstance(
        raw_target_context,
        dict
    ):
        raw_target_context = {}


    target_context = dict(
        raw_target_context
    )


    target_creature_id = (
        target_context.get(
            "target_creature_id"
        )
    )


    if target_creature_id:

        target_creature_details_allowed = (
            creature_details_allowed(
                target_creature_id
            )
        )


        target_context[
            "target_creature_discovery_state"
        ] = get_creature_state(
            target_creature_id
        )


        target_context[
            "target_creature_details_allowed"
        ] = (
            target_creature_details_allowed
        )


        if not target_creature_details_allowed:

            target_context[
                "target_creature_name"
            ] = None


    # ============================================================
    # 9. Lore Request Knowledge Filter
    #
    # 当前 Build_Decision_Context 主要包含：
    #
    # target_planet
    # target_creature
    # gene_source
    # gene_side_effect
    # game_rule
    # ============================================================

    visible_lore_requests = []

    added_lore_keys = set()


    def append_lore(
        item
    ):

        if not isinstance(
            item,
            dict
        ):
            return


        lore_key = item.get(
            "lore_key"
        )


        if not lore_key:
            return


        if lore_key in added_lore_keys:
            return


        added_lore_keys.add(
            lore_key
        )


        visible_lore_requests.append(
            dict(
                item
            )
        )


    for item in raw_lore_requests:

        if not isinstance(
            item,
            dict
        ):
            continue


        reason = item.get(
            "reason"
        )


        entity_id = item.get(
            "entity_id"
        )


        # --------------------------------------------------------
        # A. Target Creature Lore
        # --------------------------------------------------------

        if reason == "target_creature":

            if creature_details_allowed(
                entity_id
            ):

                append_lore(
                    item
                )


            continue


        # --------------------------------------------------------
        # B. Gene Source Creature Lore
        # --------------------------------------------------------

        if reason == "gene_source":

            if (
                entity_id
                in visible_source_species_ids
            ):

                append_lore(
                    item
                )


            continue


        # --------------------------------------------------------
        # C. Gene Side Effect Lore
        #
        # 只有存在可见 Gene 使用该副作用时才保留。
        # --------------------------------------------------------

        if reason == "gene_side_effect":

            if (
                entity_id
                in visible_side_effect_types
            ):

                append_lore(
                    item
                )


            continue


        # --------------------------------------------------------
        # D. Game Rule
        #
        # 只有当前 Knowledge Scope 下真的存在
        # Gene 或 Equipment 方案时，
        # 才保留基因/装备交互规则。
        # --------------------------------------------------------

        if reason == "game_rule":

            if (
                visible_has_gene_option
                or visible_has_equipment_option
            ):

                append_lore(
                    item
                )

            continue


        # --------------------------------------------------------
        # E. 其他 Lore
        # --------------------------------------------------------

        append_lore(
            item
        )


    visible_lore_requests.sort(
        key=lambda x: to_number(
            x.get(
                "priority"
            ),
            0
        ),
        reverse=True
    )


    visible_lore_keys = [

        item.get(
            "lore_key"
        )

        for item
        in visible_lore_requests

        if item.get(
            "lore_key"
        )
    ]


    # ============================================================
    # 10. Decision 同步
    #
    # Build_Decision_Context 的 Decision 是基于完整世界数据生成。
    #
    # Knowledge Filter 后必须重新同步部分统计，
    # 否则会出现：
    #
    # visible gene = 0
    #
    # 但
    #
    # better_gene_available = true
    #
    # 的矛盾。
    # ============================================================

    raw_decision = context.get(
        "decision",
        {}
    )


    if not isinstance(
        raw_decision,
        dict
    ):
        raw_decision = {}


    decision = dict(
        raw_decision
    )


    decision_type = decision.get(
        "decision_type"
    )


    # ------------------------------------------------------------
    # Gene Upgrade
    # ------------------------------------------------------------

    if decision_type == "gene_upgrade":

        better_gene_count = len(
            visible_gene_candidates
        )


        decision[
            "better_gene_available"
        ] = (
            better_gene_count > 0
        )


        decision[
            "better_gene_count"
        ] = better_gene_count


        # 当前旧版 Decision 中 needs_upgrade 的语义
        # 实际是“是否存在更强 Gene”。
        #
        # 当前先保持兼容。
        # gene_upgrade 没有 required / recommended 门槛，
        # 所以无法判断“玩家是否需要升级”。
        #
        # 只能判断：
        # 玩家正在请求升级，以及
        # 当前玩家已知范围内是否存在更强 Gene。

        decision.pop(
            "needs_upgrade",
            None
        )


        decision[
            "upgrade_requested"
        ] = True


        decision[
            "better_gene_available"
        ] = (
            better_gene_count > 0
        )


        decision[
            "better_gene_count"
        ] = better_gene_count


        decision[
            "best_available_gene_value"
        ] = (
            visible_gene_candidates[0].get(
                "bonus"
            )
            if visible_gene_candidates
            else None
        )


        decision[
            "availability_scope"
        ] = "player_known"


        decision[
            "best_available_gene_value"
        ] = (
            visible_gene_candidates[0].get(
                "bonus"
            )
            if visible_gene_candidates
            else None
        )


        decision[
            "availability_scope"
        ] = "player_known"


    # ------------------------------------------------------------
    # Mission / Planet / Environment Preparation
    # ------------------------------------------------------------

    else:

        visible_viable_options = [

            option

            for option
            in visible_calculated_options

            if (
                isinstance(
                    option,
                    dict
                )

                and

                option.get(
                    "meets_required",
                    False
                )
            )
        ]


        visible_recommended_options = [

            option

            for option
            in visible_calculated_options

            if (
                isinstance(
                    option,
                    dict
                )

                and

                option.get(
                    "meets_recommended",
                    False
                )
            )
        ]


        if (
            "viable_option_count"
            in decision
        ):

            decision[
                "viable_option_count"
            ] = len(
                visible_viable_options
            )


        if (
            "recommended_option_count"
            in decision
        ):

            decision[
                "recommended_option_count"
            ] = len(
                visible_recommended_options
            )


        decision[
            "availability_scope"
        ] = "player_known"


    # ============================================================
    # 11. Knowledge Filter Debug Stats
    #
    # 只记录数量。
    #
    # 不输出被过滤 Creature / Gene 的 ID，
    # 避免 Debug 数据自己成为剧透通道。
    # ============================================================

    knowledge_filter_stats = {

        "creature_disclosure_threshold":
            "scanned",


        "raw_gene_candidate_count":
            len(
                raw_gene_candidates
            ),


        "visible_gene_candidate_count":
            len(
                visible_gene_candidates
            ),


        "knowledge_filtered_gene_candidate_count":
            (
                len(
                    raw_gene_candidates
                )
                -
                len(
                    visible_gene_candidates
                )
            ),


        "raw_excluded_gene_candidate_count":
            len(
                raw_excluded_gene_candidates
            ),


        "visible_excluded_gene_candidate_count":
            len(
                visible_excluded_gene_candidates
            ),


        "raw_calculated_option_count":
            len(
                raw_calculated_options
            ),


        "visible_calculated_option_count":
            len(
                visible_calculated_options
            ),


        "knowledge_filtered_calculated_option_count":
            (
                len(
                    raw_calculated_options
                )
                -
                len(
                    visible_calculated_options
                )
            ),


        "raw_lore_request_count":
            len(
                raw_lore_requests
            ),


        "visible_lore_request_count":
            len(
                visible_lore_requests
            ),


        "knowledge_filtered_lore_request_count":
            (
                len(
                    raw_lore_requests
                )
                -
                len(
                    visible_lore_requests
                )
            )
    }


    # ============================================================
    # 12. 最终 Context
    #
    # 保持 Build_Decision_Context 原结构。
    #
    # Option_Selection 不需要修改输入 schema。
    # ============================================================

    result = dict(
        context
    )


    result[
        "target_context"
    ] = target_context


    result[
        "gene_candidates"
    ] = visible_gene_candidates


    result[
        "excluded_gene_candidates"
    ] = (
        visible_excluded_gene_candidates
    )


    # Equipment 当前不受 Discovery State 限制
    result[
        "equipment_candidates"
    ] = raw_equipment_candidates


    result[
        "calculated_options"
    ] = visible_calculated_options


    result[
        "decision"
    ] = decision


    result[
        "lore_requests"
    ] = visible_lore_requests


    result[
        "lore_keys"
    ] = visible_lore_keys


    result[
        "knowledge_filter_stats"
    ] = knowledge_filter_stats


    # ============================================================
    # 13. RAGFlow Code 节点统一返回 String
    # ============================================================

    return json_output(
        result
    )
