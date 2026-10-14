# -*- coding: utf-8 -*-
"""
Option_Selection：可行方案过滤、去重、非支配筛选、代表方案选择

来源：RAGFlow 画布「FTS游戏精灵0.5」节点 CodeExec:UpsetMelonsSmoke
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


    def get_equipment_energy_cost(option):
        """
        兼容两种字段：

        新字段：
            equipment_energy_cost

        旧 Build_Decision_Context 字段：
            energy_cost

        Option_Selection 最终统一输出：
            equipment_energy_cost
        """
        if not isinstance(option, dict):
            return 0

        if (
            "equipment_energy_cost"
            in option
        ):
            return to_number(
                option.get(
                    "equipment_energy_cost"
                ),
                0
            )

        return to_number(
            option.get(
                "energy_cost"
            ),
            0
        )


    def side_effect_metrics(option):

        effects = option.get(
            "side_effects",
            []
        )

        if not isinstance(
            effects,
            list
        ):
            effects = []

        count = 0
        burden = 0.0


        for effect in effects:

            if not isinstance(
                effect,
                dict
            ):
                continue


            effect_type = effect.get(
                "type"
            )


            if (
                not effect_type
                or effect_type == "none"
            ):
                continue


            count += 1


            burden += abs(
                to_number(
                    effect.get(
                        "value"
                    ),
                    0
                )
            )


        return count, burden


    def component_count(option):

        count = 0


        if option.get(
            "gene_id"
        ):
            count += 1


        if option.get(
            "equipment_id"
        ):
            count += 1


        return count


    def status_rank(option):

        status = option.get(
            "status"
        )


        if status == "recommended":
            return 2


        if status == "acceptable_with_risk":
            return 1


        if status == "better_than_current":
            return 1


        if status == "current":
            return 0


        return 0


    # ============================================================
    # 2. 解析 Decision Context
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


    calculated_options = context.get(
        "calculated_options",
        []
    )


    if not isinstance(
        calculated_options,
        list
    ):
        calculated_options = []


    target_context = context.get(
        "target_context",
        {}
    )


    if not isinstance(
        target_context,
        dict
    ):
        target_context = {}


    decision = context.get(
        "decision",
        {}
    )


    if not isinstance(
        decision,
        dict
    ):
        decision = {}


    decision_type = decision.get(
        "decision_type"
    )


    required_value = target_context.get(
        "required_value"
    )

    recommended_value = target_context.get(
        "recommended_value"
    )


    if required_value is not None:

        required_value = to_number(
            required_value
        )


    if recommended_value is not None:

        recommended_value = to_number(
            recommended_value
        )


    # ============================================================
    # 3. 过滤“有效可行方案”
    # ============================================================

    viable_options = []


    for option in calculated_options:

        if not isinstance(
            option,
            dict
        ):
            continue


        # --------------------------------------------------------
        # Gene Upgrade
        #
        # 没有 required_value。
        #
        # “可行”表示：
        # - gene_only
        # - 确实比当前 Gene 更好
        # --------------------------------------------------------

        if (
            decision_type
            == "gene_upgrade"
        ):

            if (
                option.get(
                    "option_type"
                )
                == "gene_only"

                and

                option.get(
                    "status"
                )
                == "better_than_current"
            ):

                viable_options.append(
                    dict(
                        option
                    )
                )


            continue


        # --------------------------------------------------------
        # Mission / Planet Preparation
        #
        # 只保留达到最低要求的方案。
        # --------------------------------------------------------

        if option.get(
            "meets_required",
            False
        ):

            viable_options.append(
                dict(
                    option
                )
            )


    # ============================================================
    # 4. 精确去重
    # ============================================================

    deduplicated_options = []

    seen_keys = set()


    for option in viable_options:

        key = (

            option.get(
                "option_type"
            ),

            option.get(
                "gene_id"
            ),

            option.get(
                "equipment_id"
            ),

            to_number(
                option.get(
                    "effective_value"
                )
            )
        )


        if key in seen_keys:
            continue


        seen_keys.add(
            key
        )


        deduplicated_options.append(
            option
        )


    # ============================================================
    # 5. 计算 Selection Metrics
    #
    # effective_value 超过 recommended_value 后，
    # 不继续奖励额外数值。
    #
    # 例如：
    #
    # recommended = 60
    #
    # 60 → decision_effective = 60
    # 72 → decision_effective = 60
    # 80 → decision_effective = 60
    #
    # 防止把 overkill 自动理解为：
    # “更安全 / 更优 / 更推荐”。
    # ============================================================

    for option in deduplicated_options:

        effective = to_number(
            option.get(
                "effective_value"
            )
        )


        if (
            recommended_value
            is not None

            and

            decision_type
            != "gene_upgrade"
        ):

            decision_effective = min(
                effective,
                recommended_value
            )

        else:

            decision_effective = effective


        (
            effect_count,
            effect_burden
        ) = side_effect_metrics(
            option
        )


        option[
            "_selection_metrics"
        ] = {

            "decision_effective":
                decision_effective,

            "status_rank":
                status_rank(
                    option
                ),

            "equipment_energy_cost":
                get_equipment_energy_cost(
                    option
                ),

            "side_effect_count":
                effect_count,

            "side_effect_burden":
                effect_burden,

            "component_count":
                component_count(
                    option
                )
        }


    # ============================================================
    # 6. Dominance / 去冗余
    #
    # A 支配 B，当：
    #
    # A 的任务效果 >= B
    # A 的状态等级 >= B
    # A 的装备能耗 <= B
    # A 的副作用数量 <= B
    # A 的副作用负担 <= B
    # A 的组件数量 <= B
    #
    # 并且至少有一项严格更好。
    # ============================================================

    def dominates(
        a,
        b
    ):

        ma = a[
            "_selection_metrics"
        ]

        mb = b[
            "_selection_metrics"
        ]


        conditions = [

            ma[
                "decision_effective"
            ]
            >=
            mb[
                "decision_effective"
            ],

            ma[
                "status_rank"
            ]
            >=
            mb[
                "status_rank"
            ],

            ma[
                "equipment_energy_cost"
            ]
            <=
            mb[
                "equipment_energy_cost"
            ],

            ma[
                "side_effect_count"
            ]
            <=
            mb[
                "side_effect_count"
            ],

            ma[
                "side_effect_burden"
            ]
            <=
            mb[
                "side_effect_burden"
            ],

            ma[
                "component_count"
            ]
            <=
            mb[
                "component_count"
            ]
        ]


        if not all(
            conditions
        ):
            return False


        strict = (

            ma[
                "decision_effective"
            ]
            >
            mb[
                "decision_effective"
            ]

            or

            ma[
                "status_rank"
            ]
            >
            mb[
                "status_rank"
            ]

            or

            ma[
                "equipment_energy_cost"
            ]
            <
            mb[
                "equipment_energy_cost"
            ]

            or

            ma[
                "side_effect_count"
            ]
            <
            mb[
                "side_effect_count"
            ]

            or

            ma[
                "side_effect_burden"
            ]
            <
            mb[
                "side_effect_burden"
            ]

            or

            ma[
                "component_count"
            ]
            <
            mb[
                "component_count"
            ]
        )


        return strict


    non_dominated_options = []


    for index_b, option_b in enumerate(
        deduplicated_options
    ):

        dominated = False


        for index_a, option_a in enumerate(
            deduplicated_options
        ):

            if index_a == index_b:
                continue


            if dominates(
                option_a,
                option_b
            ):

                dominated = True
                break


        if not dominated:

            non_dominated_options.append(
                option_b
            )


    # ============================================================
    # 7. 建立 Gene / Equipment 数据索引
    #
    # 让 decision_options 自己带上：
    # - 稀有度
    # - 库存
    # - Gene 来源
    #
    # 后面的 LLM 不需要再看全部 candidate 数据。
    # ============================================================

    gene_candidates = context.get(
        "gene_candidates",
        []
    )


    if not isinstance(
        gene_candidates,
        list
    ):
        gene_candidates = []


    equipment_candidates = context.get(
        "equipment_candidates",
        []
    )


    if not isinstance(
        equipment_candidates,
        list
    ):
        equipment_candidates = []


    gene_map = {

        item.get(
            "gene_id"
        ): item

        for item in gene_candidates

        if isinstance(
            item,
            dict
        )
    }


    equipment_map = {

        item.get(
            "equipment_id"
        ): item

        for item in equipment_candidates

        if isinstance(
            item,
            dict
        )
    }


    # ============================================================
    # 8. 代表方案选择
    #
    # 最多输出 4 条真正值得玩家考虑的方案。
    #
    # role 仅表示“方案类别”，
    # 不表示全局最佳排名。
    # ============================================================

    selected = []

    selected_keys = set()


    def option_key(option):

        return (

            option.get(
                "option_type"
            ),

            option.get(
                "gene_id"
            ),

            option.get(
                "equipment_id"
            )
        )


    def add_selected(
        option,
        role,
        selection_reason
    ):

        if not option:
            return


        key = option_key(
            option
        )


        if key in selected_keys:
            return


        if len(
            selected
        ) >= 4:
            return


        selected_keys.add(
            key
        )


        result_option = dict(
            option
        )


        # --------------------------------------------------------
        # 不把内部 selection metrics
        # 暴露给最终 LLM。
        # --------------------------------------------------------

        result_option.pop(
            "_selection_metrics",
            None
        )


        # --------------------------------------------------------
        # 统一字段：
        #
        # 上游目前可能仍然是 energy_cost，
        # 这里最终统一输出 equipment_energy_cost。
        # --------------------------------------------------------

        result_option[
            "equipment_energy_cost"
        ] = get_equipment_energy_cost(
            result_option
        )


        result_option.pop(
            "energy_cost",
            None
        )


        # --------------------------------------------------------
        # 方案类别 / 选择原因
        # --------------------------------------------------------

        result_option[
            "role"
        ] = role


        result_option[
            "selection_reason"
        ] = selection_reason


        # --------------------------------------------------------
        # 补 Gene 信息
        # --------------------------------------------------------

        gene_id = result_option.get(
            "gene_id"
        )


        if gene_id:

            gene = gene_map.get(
                gene_id,
                {}
            )


            result_option[
                "gene_rarity"
            ] = gene.get(
                "rarity"
            )


            result_option[
                "gene_stock"
            ] = gene.get(
                "stock"
            )


            result_option[
                "source_species_id"
            ] = gene.get(
                "source_species_id"
            )


            result_option[
                "source_species_name"
            ] = gene.get(
                "source_species_name"
            )


        # --------------------------------------------------------
        # 补 Equipment 信息
        # --------------------------------------------------------

        equipment_id = result_option.get(
            "equipment_id"
        )


        if equipment_id:

            item = equipment_map.get(
                equipment_id,
                {}
            )


            result_option[
                "equipment_rarity"
            ] = item.get(
                "rarity"
            )


            result_option[
                "equipment_stock"
            ] = item.get(
                "stock"
            )


        selected.append(
            result_option
        )


    # ============================================================
    # A. 当前状态已经可行
    #
    # current 本身就是一个合法方案。
    # ============================================================

    current_options = [

        x
        for x in non_dominated_options

        if x.get(
            "option_type"
        ) == "current"
    ]


    if current_options:

        add_selected(

            current_options[0],

            "no_change",

            "当前状态已经达到任务最低要求，无需强制强化。"
        )


    # ============================================================
    # B. 推荐标准：结构最简单的方案
    #
    # role:
    # simple_recommended
    #
    # 表示：
    # 达到 recommended，
    # 并优先选择组件数量更少、装备能耗更低的方案。
    #
    # 不表示：
    # “最安全 / 最佳 / 全局最推荐”。
    # ============================================================

    recommended_options = [

        x
        for x in non_dominated_options

        if x.get(
            "status"
        ) == "recommended"
    ]


    if recommended_options:

        simple_recommended = sorted(

            recommended_options,

            key=lambda x: (

                x[
                    "_selection_metrics"
                ][
                    "component_count"
                ],

                x[
                    "_selection_metrics"
                ][
                    "equipment_energy_cost"
                ],

                x[
                    "_selection_metrics"
                ][
                    "side_effect_count"
                ],

                x[
                    "_selection_metrics"
                ][
                    "side_effect_burden"
                ]
            )

        )[0]


        add_selected(

            simple_recommended,

            "simple_recommended",

            "达到推荐标准，并且方案结构较简单。"
        )


    # ============================================================
    # C. 推荐标准：没有记录 Gene 副作用的方案
    #
    # 注意：
    #
    # 这里不是“副作用最少”。
    #
    # 只有 side_effect_count == 0
    # 才允许标记：
    #
    # no_recorded_gene_side_effect
    #
    # 避免所有方案都有副作用时，
    # 错误地把“较少副作用”描述成“没有副作用”。
    # ============================================================

    no_side_effect_options = [

        x
        for x in recommended_options

        if x[
            "_selection_metrics"
        ][
            "side_effect_count"
        ] == 0
    ]


    if no_side_effect_options:

        no_recorded_gene_side_effect = sorted(

            no_side_effect_options,

            key=lambda x: (

                x[
                    "_selection_metrics"
                ][
                    "equipment_energy_cost"
                ],

                x[
                    "_selection_metrics"
                ][
                    "component_count"
                ]
            )

        )[0]


        if no_recorded_gene_side_effect.get(
            "equipment_id"
        ):

            no_side_effect_reason = (
                "达到推荐标准；"
                "该方案所使用的基因未记录副作用，"
                "但仍需考虑装备能耗。"
            )

        else:

            no_side_effect_reason = (
                "达到推荐标准；"
                "该方案所使用的基因未记录副作用。"
            )


        add_selected(

            no_recorded_gene_side_effect,

            "no_recorded_gene_side_effect",

            no_side_effect_reason
        )


    # ============================================================
    # D. 最低可行方案
    #
    # acceptable_with_risk 中优先：
    #
    # 1. 装备能耗低
    # 2. Gene 副作用少
    # 3. effective_value 较低
    #
    # 注意：
    # 这里只表示“达到最低要求”，
    # 不表示总体资源成本最低。
    # ============================================================

    acceptable_options = [

        x
        for x in non_dominated_options

        if x.get(
            "status"
        ) == "acceptable_with_risk"
    ]


    if acceptable_options:

        minimum_viable = sorted(

            acceptable_options,

            key=lambda x: (

                x[
                    "_selection_metrics"
                ][
                    "equipment_energy_cost"
                ],

                x[
                    "_selection_metrics"
                ][
                    "side_effect_count"
                ],

                to_number(
                    x.get(
                        "effective_value"
                    )
                )
            )

        )[0]


        add_selected(

            minimum_viable,

            "minimum_viable",

            "达到最低任务要求，但尚未达到推荐标准。"
        )


    # ============================================================
    # E. 如果不足 2～4 条，
    #    从剩余非支配方案中补充。
    #
    # 注意：
    # alternative 仅表示存在不同取舍，
    # 不表示优于其他方案。
    # ============================================================

    remaining_options = sorted(

        non_dominated_options,

        key=lambda x: (

            -x[
                "_selection_metrics"
            ][
                "status_rank"
            ],

            x[
                "_selection_metrics"
            ][
                "side_effect_count"
            ],

            x[
                "_selection_metrics"
            ][
                "equipment_energy_cost"
            ],

            x[
                "_selection_metrics"
            ][
                "component_count"
            ]
        )
    )


    for option in remaining_options:

        if len(
            selected
        ) >= 4:
            break


        add_selected(

            option,

            "alternative",

            "这是一个与其他代表方案存在不同属性、装备能耗或副作用取舍的可行方案。"
        )


    # ============================================================
    # 9. Lore Requests 重新过滤
    #
    # Lore 不再跟所有 calculated_options 走，
    # 而只跟 decision_options 走。
    # ============================================================

    original_lore_requests = context.get(
        "lore_requests",
        []
    )


    if not isinstance(
        original_lore_requests,
        list
    ):
        original_lore_requests = []


    selected_gene_ids = {

        x.get(
            "gene_id"
        )

        for x in selected

        if x.get(
            "gene_id"
        )
    }


    selected_source_species_ids = set()

    selected_side_effect_types = set()


    for gene_id in selected_gene_ids:

        gene = gene_map.get(
            gene_id,
            {}
        )


        source_species_id = gene.get(
            "source_species_id"
        )


        if source_species_id:

            selected_source_species_ids.add(
                source_species_id
            )


        side_effect_type = gene.get(
            "side_effect_type"
        )


        if (
            side_effect_type
            and side_effect_type != "none"
        ):

            selected_side_effect_types.add(
                side_effect_type
            )


    selected_has_equipment = any(

        x.get(
            "equipment_id"
        )

        for x in selected
    )


    filtered_lore_requests = []


    for item in original_lore_requests:

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
        # 星球和任务目标生物始终保留
        # --------------------------------------------------------

        if reason in (
            "target_planet",
            "target_creature"
        ):

            filtered_lore_requests.append(
                item
            )

            continue


        # --------------------------------------------------------
        # 只保留真正被选中 Gene 的来源生物
        # --------------------------------------------------------

        if reason == "gene_source":

            if (
                entity_id
                in selected_source_species_ids
            ):

                filtered_lore_requests.append(
                    item
                )


            continue


        # --------------------------------------------------------
        # 只保留真正被选中 Gene 的副作用
        # --------------------------------------------------------

        if reason == "gene_side_effect":

            if (
                entity_id
                in selected_side_effect_types
            ):

                filtered_lore_requests.append(
                    item
                )


            continue


        # --------------------------------------------------------
        # 只有最终方案实际涉及 Equipment，
        # 或是 Gene Upgrade 场景，
        # 才保留基因/装备组合规则。
        # --------------------------------------------------------

        if reason == "game_rule":

            if (
                selected_has_equipment

                or

                decision_type
                == "gene_upgrade"
            ):

                filtered_lore_requests.append(
                    item
                )


            continue


    # ============================================================
    # 10. Lore 去重
    # ============================================================

    filtered_unique_lore = []

    seen_lore_keys = set()


    for item in filtered_lore_requests:

        lore_key = item.get(
            "lore_key"
        )


        if not lore_key:
            continue


        if lore_key in seen_lore_keys:
            continue


        seen_lore_keys.add(
            lore_key
        )


        filtered_unique_lore.append(
            item
        )


    lore_keys = [

        x.get(
            "lore_key"
        )

        for x in filtered_unique_lore
    ]


    # ============================================================
    # 11. 原始方案统计
    #
    # 这些仅用于：
    # - Debug
    # - 观察 Option Selection 漏斗
    #
    # 不放进最终 decision。
    # ============================================================

    raw_recommended_option_count = len([

        x
        for x in viable_options

        if x.get(
            "status"
        ) == "recommended"
    ])


    # ============================================================
    # 12. 更新 Decision
    #
    # 移除 Build_Decision_Context 中旧的：
    #
    # viable_option_count
    # recommended_option_count
    #
    # 最终 decision 只保留真正有决策意义的信息。
    # ============================================================

    output_decision = dict(
        decision
    )


    output_decision.pop(
        "viable_option_count",
        None
    )


    output_decision.pop(
        "recommended_option_count",
        None
    )


    output_decision[
        "decision_option_count"
    ] = len(
        selected
    )


    output_decision[
        "has_viable_decision_option"
    ] = len(
        selected
    ) > 0


    # ============================================================
    # 13. 最终给 Sprite_Response 的精简 Context
    #
    # 故意不输出：
    #
    # calculated_options
    # excluded_gene_candidates
    # 全部 gene_candidates
    # 全部 equipment_candidates
    #
    # 防止 LLM 再从原始组合中自行扩展方案。
    # ============================================================

    result = {

        "status":
            context.get(
                "status",
                "success"
            ),


        "intent_resolution":
            context.get(
                "intent_resolution",
                {}
            ),


        "player_state":
            context.get(
                "player_state",
                {}
            ),
            
        # --------------------------------------------------------
        # Player Knowledge Scope
        # --------------------------------------------------------

        "knowledge_scope":
            context.get(
                "knowledge_scope",
                {}
            ),


        # --------------------------------------------------------
        # Knowledge Scope Filter Debug
        # --------------------------------------------------------

        "knowledge_filter_stats":
            context.get(
                "knowledge_filter_stats",
                {}
            ),

        "target_context":
            target_context,


        "decision":
            output_decision,


        "option_selection": {

            "raw_calculated_option_count":
                len(
                    calculated_options
                ),

            "raw_viable_option_count":
                len(
                    viable_options
                ),

            "raw_recommended_option_count":
                raw_recommended_option_count,

            "raw_deduplicated_option_count":
                len(
                    deduplicated_options
                ),

            "raw_non_dominated_option_count":
                len(
                    non_dominated_options
                ),

            "decision_option_count":
                len(
                    selected
                )
        },


        "decision_options":
            selected,


        "lore_requests":
            filtered_unique_lore,


        "lore_keys":
            lore_keys
    }


    # ============================================================
    # 14. RAGFlow Code 节点统一返回 String
    # ============================================================

    return json_output(
        result
    )
