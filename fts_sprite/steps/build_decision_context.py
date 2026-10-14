# -*- coding: utf-8 -*-
"""
Build_Decision_Context：玩家/任务/星球/基因/装备 → 决策上下文与候选方案

来源：RAGFlow 画布「FTS游戏精灵0.5」节点 CodeExec:ShinySidesSell
本文件的 main() 与画布 Code 节点脚本保持一致（逐字迁移），
后续在 RAGFlow 中调整脚本时，可直接整体替换 main() 函数。
请勿在 main() 内加入 print：日志请使用 logging。
"""

import json


def main(
    intent_json: str,
    player_json: str,
    missions_json: str,
    planets_json: str,
    genes_json: str,
    equipment_json: str,
    creatures_json: str,
    discoveries_json: str
) -> str:

    # ============================================================
    # 1. 基础工具
    # ============================================================

    def parse_json(value, default):
        """
        兼容：
        - 标准 JSON String
        - 已经是 dict / list
        - LLM 偶尔返回 ```json ... ``` 包裹
        """
        if value is None:
            return default

        if isinstance(value, (dict, list)):
            return value

        if not isinstance(value, str):
            return default

        text = value.strip()

        if text.startswith("```"):
            lines = text.splitlines()

            if lines and lines[0].startswith("```"):
                lines = lines[1:]

            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]

            text = "\n".join(lines).strip()

        try:
            result = json.loads(text)

            if result is None:
                return default

            return result

        except Exception:
            return default


    def as_list(value):
        if isinstance(value, list):
            return value

        if isinstance(value, dict):
            return [value]

        return []


    def to_number(value, default=0):
        try:
            return float(value)
        except Exception:
            return default


    def to_int(value, default=0):
        try:
            return int(float(value))
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


    def get_status(value, required, recommended):
        """
        只用于存在明确环境/任务阈值的场景。
        gene_upgrade 不调用此函数。
        """
        if value < required:
            return "insufficient"

        if value < recommended:
            return "acceptable_with_risk"

        return "recommended"


    def json_output(data):
        return json.dumps(
            data,
            ensure_ascii=False
        )


    # ============================================================
    # 2. 解析输入
    # ============================================================

    intent_data = parse_json(
        intent_json,
        {}
    )

    player_data = parse_json(
        player_json,
        {}
    )

    missions = as_list(
        parse_json(
            missions_json,
            []
        )
    )

    planets = as_list(
        parse_json(
            planets_json,
            []
        )
    )

    genes = as_list(
        parse_json(
            genes_json,
            []
        )
    )

    equipment = as_list(
        parse_json(
            equipment_json,
            []
        )
    )

    creatures = as_list(
        parse_json(
            creatures_json,
            []
        )
    )

    discoveries = as_list(
        parse_json(
            discoveries_json,
            []
        )
    )

    # ============================================================
    # 3. 玩家数据
    # ============================================================

    # 兼容：
    # GET /players/P001 → Object
    # GET /players      → Array

    if isinstance(player_data, list):

        if len(player_data) == 0:
            return json_output({
                "status": "error",
                "error_code": "PLAYER_NOT_FOUND",
                "message": "No player data found."
            })

        player = player_data[0]

    elif isinstance(player_data, dict):

        player = player_data

    else:

        return json_output({
            "status": "error",
            "error_code": "INVALID_PLAYER_DATA",
            "message": "Player data is invalid."
        })


    # ============================================================
    # 4. 建立数据库索引
    # ============================================================

    mission_map = {
        x.get(
            "mission_id",
            x.get("id")
        ): x
        for x in missions
        if isinstance(x, dict)
    }

    planet_map = {
        x.get(
            "planet_id",
            x.get("id")
        ): x
        for x in planets
        if isinstance(x, dict)
    }

    creature_map = {
        x.get(
            "creature_id",
            x.get("id")
        ): x
        for x in creatures
        if isinstance(x, dict)
    }


    # ============================================================
    # 5. 玩家当前状态
    # ============================================================

    player_id = player.get(
        "player_id",
        player.get("id")
    )

    active_mission_id = player.get(
        "active_mission_id"
    )

    current_planet_id = player.get(
        "current_planet_id"
    )

    # ============================================================
    # 5.1 Player Knowledge / Discovery State
    #
    # 设计原则：
    #
    # World Knowledge != Player-known Knowledge
    #
    # player_discoveries 只表示：
    # “玩家已经知道某个世界实体到什么程度”
    #
    # 不表示：
    # - 当前是否还持有样本
    # - 当前是否拥有 Feature
    # - 当前是否可以使用某项 Gene
    #
    # 这些未来分别由：
    # player_samples / player_features / player_genomes 管理。
    #
    # Creature Discovery State：
    #
    # encountered < scanned < sampled < analyzed
    #
    # 状态使用累计语义：
    #
    # analyzed
    #   同时意味着：
    #   encountered + scanned + sampled + analyzed
    #
    # unknown 不写入 player_discoveries：
    # 如果某 Creature 没有记录，就视为 unknown。
    # ============================================================

    CREATURE_DISCOVERY_RANK = {
        "encountered": 1,
        "scanned": 2,
        "sampled": 3,
        "analyzed": 4
    }

    CREATURE_DISCOVERY_STATE = {
        1: "encountered",
        2: "scanned",
        3: "sampled",
        4: "analyzed"
    }


    # ------------------------------------------------------------
    # 同一个 Creature 理论上只应该存在一条 Discovery 记录。
    #
    # 但开发阶段为了容错：
    # 如果出现多条记录，则保留等级最高的状态。
    #
    # 例如：
    #
    # CR001 encountered
    # CR001 scanned
    #
    # 最终：
    # CR001 = scanned
    # ------------------------------------------------------------

    creature_discovery_rank_by_id = {}


    for discovery in discoveries:

        if not isinstance(
            discovery,
            dict
        ):
            continue


        # --------------------------------------------------------
        # 只处理当前玩家
        # --------------------------------------------------------

        discovery_player_id = discovery.get(
            "player_id"
        )

        if (
            discovery_player_id is not None
            and str(discovery_player_id)
            != str(player_id)
        ):
            continue


        # --------------------------------------------------------
        # v0.1 第一阶段只处理 Creature
        #
        # Planet / Zone / Plant / Resource
        # 后续再扩展。
        # --------------------------------------------------------

        entity_type = discovery.get(
            "entity_type"
        )

        if isinstance(
            entity_type,
            str
        ):
            entity_type = (
                entity_type
                .strip()
                .lower()
            )

        if entity_type != "creature":
            continue


        # --------------------------------------------------------
        # Entity ID
        # --------------------------------------------------------

        entity_id = discovery.get(
            "entity_id"
        )

        if not entity_id:
            continue


        # --------------------------------------------------------
        # 防止 Discovery 引用已经不存在的 Creature
        #
        # Game Server World State 仍然是事实源。
        # --------------------------------------------------------

        if entity_id not in creature_map:
            continue


        # --------------------------------------------------------
        # Discovery State
        #
        # 正式字段：
        # discovery_state
        #
        # 同时兼容旧测试字段：
        # state
        # --------------------------------------------------------

        discovery_state = discovery.get(
            "discovery_state",
            discovery.get("state")
        )

        if isinstance(
            discovery_state,
            str
        ):
            discovery_state = (
                discovery_state
                .strip()
                .lower()
            )


        discovery_rank = (
            CREATURE_DISCOVERY_RANK.get(
                discovery_state
            )
        )

        if discovery_rank is None:
            continue


        # --------------------------------------------------------
        # 如果重复记录，保留最高认知状态
        # --------------------------------------------------------

        previous_rank = (
            creature_discovery_rank_by_id.get(
                entity_id,
                0
            )
        )

        if discovery_rank > previous_rank:

            creature_discovery_rank_by_id[
                entity_id
            ] = discovery_rank


    # ============================================================
    # 构造 Creature State Map
    # ============================================================

    creature_state_by_id = {
        creature_id:
            CREATURE_DISCOVERY_STATE[
                rank
            ]

        for creature_id, rank
        in sorted(
            creature_discovery_rank_by_id.items()
        )
    }


    # ============================================================
    # 构造累计状态集合
    #
    # analyzed:
    # encountered = True
    # scanned     = True
    # sampled     = True
    # analyzed    = True
    # ============================================================

    encountered_creature_ids = sorted([
        creature_id

        for creature_id, rank
        in creature_discovery_rank_by_id.items()

        if rank >= 1
    ])


    scanned_creature_ids = sorted([
        creature_id

        for creature_id, rank
        in creature_discovery_rank_by_id.items()

        if rank >= 2
    ])


    sampled_creature_ids = sorted([
        creature_id

        for creature_id, rank
        in creature_discovery_rank_by_id.items()

        if rank >= 3
    ])


    analyzed_creature_ids = sorted([
        creature_id

        for creature_id, rank
        in creature_discovery_rank_by_id.items()

        if rank >= 4
    ])


    # ============================================================
    # 最终 Knowledge Scope
    #
    # 注意：
    #
    # 当前阶段只建立玩家知识边界。
    #
    # 这里暂时：
    # - 不过滤 gene_candidates
    # - 不过滤 calculated_options
    # - 不过滤 lore_requests
    #
    # 下一阶段 Knowledge_Scope_Filter 再真正执行过滤。
    # ============================================================

    knowledge_scope = {

        "allow_undiscovered_entity_details":
            False,

        "creature_state_by_id":
            creature_state_by_id,

        "encountered_creature_ids":
            encountered_creature_ids,

        "scanned_creature_ids":
            scanned_creature_ids,

        "sampled_creature_ids":
            sampled_creature_ids,

        "analyzed_creature_ids":
            analyzed_creature_ids
    }

    # ============================================================
    # 6. 解析 Intent Resolver 输出
    # ============================================================

    allowed_intents = {
        "current_mission_preparation",
        "mission_preparation",
        "planet_preparation",
        "environment_preparation",
        "gene_upgrade",
        "unknown"
    }

    allowed_stats = {
        "heat_resistance",
        "cold_resistance",
        "radiation_resistance",
        "strength"
    }


    intent = intent_data.get(
        "intent",
        "unknown"
    )

    if intent not in allowed_intents:
        intent = "unknown"


    target_mission_id = intent_data.get(
        "target_mission_id"
    )

    target_planet_id = intent_data.get(
        "target_planet_id"
    )

    explicit_target_creature_id = intent_data.get(
        "target_creature_id"
    )

    requested_stat = intent_data.get(
        "requested_stat"
    )

    if requested_stat not in allowed_stats:
        requested_stat = None


    use_active_mission = to_bool(
        intent_data.get(
            "use_active_mission"
        ),
        False
    )

    confidence = to_number(
        intent_data.get(
            "confidence"
        ),
        0
    )


    # ============================================================
    # 7. 初始化目标上下文
    # ============================================================

    mission = None
    target_planet = None
    target_creature = None

    required_stat = None

    # 注意：
    # gene_upgrade 没有环境阈值，所以使用 None，
    # 不能使用 0，否则会产生错误的 recommended 判断。
    required_value = None
    recommended_value = None

    requirement_source = None

    resolution_warnings = []
    environment_scope = None

    # ============================================================
    # 8. 根据 Intent 决定本轮真正目标
    #
    # 优先级：
    #
    # 明确 Mission
    #   >
    # 明确 Planet
    #   >
    # 明确 Stat / Gene
    #   >
    # 当前 Active Mission
    #   >
    # 当前 Planet
    #
    # Intent Resolver 只理解“玩家在问什么”。
    # 真正数值仍来自数据库。
    # ============================================================


    # ------------------------------------------------------------
    # A. 明确 Mission
    # ------------------------------------------------------------

    if target_mission_id:

        mission = mission_map.get(
            target_mission_id
        )

        if not mission:

            return json_output({
                "status": "error",
                "error_code": "MISSION_NOT_FOUND",
                "message":
                    "Intent Resolver returned an unknown mission.",
                "intent_resolution": {
                    "intent": intent,
                    "confidence": confidence,
                    "target_mission_id":
                        target_mission_id
                }
            })


        mission_planet_id = mission.get(
            "target_planet_id"
        )

        target_planet = planet_map.get(
            mission_planet_id
        )

        mission_creature_id = mission.get(
            "target_creature_id"
        )

        if mission_creature_id:

            target_creature = creature_map.get(
                mission_creature_id
            )


        required_stat = mission.get(
            "required_stat"
        )

        required_value = to_number(
            mission.get(
                "required_value"
            )
        )

        recommended_value = to_number(
            mission.get(
                "recommended_value"
            )
        )

        requirement_source = "explicit_mission"


    # ------------------------------------------------------------
    # B. 明确 Planet
    # ------------------------------------------------------------

    elif target_planet_id:

        target_planet = planet_map.get(
            target_planet_id
        )

        if not target_planet:

            return json_output({
                "status": "error",
                "error_code": "PLANET_NOT_FOUND",
                "message":
                    "Intent Resolver returned an unknown planet.",
                "intent_resolution": {
                    "intent": intent,
                    "confidence": confidence,
                    "target_planet_id":
                        target_planet_id
                }
            })


        required_stat = target_planet.get(
            "required_stat"
        )

        required_value = to_number(
            target_planet.get(
                "required_value"
            )
        )

        recommended_value = to_number(
            target_planet.get(
                "recommended_value"
            )
        )

        requirement_source = "explicit_planet"


    # ------------------------------------------------------------
    # C. 当前环境危险
    #
    # environment_preparation 表示：
    #
    # 玩家正在处理“当前位置”的环境危险。
    #
    # 当前 v0.1 尚无 Zone 数据，
    # 所以暂时使用 current_planet 作为环境来源。
    #
    # 后续加入 Zone 后：
    #
    # current_planet
    #     ↓
    # current_zone
    #
    # 这里只需要替换环境来源，
    # 后面的 Decision / Option Selection 不需要重构。
    # ------------------------------------------------------------

    elif intent == "environment_preparation":

        target_planet = planet_map.get(
            current_planet_id
        )


        if not target_planet:

            return json_output({
                "status":
                    "error",

                "error_code":
                    "CURRENT_PLANET_NOT_FOUND",

                "message":
                    "Current planet could not be resolved "
                    "for environment preparation."
            })


        planet_required_stat = (
            target_planet.get(
                "required_stat"
            )
        )


        # --------------------------------------------------------
        # 如果 Intent Resolver 已经识别出具体危险：
        #
        # heat_resistance / cold_resistance /
        # radiation_resistance
        #
        # 则以 requested_stat 为玩家正在处理的问题。
        # --------------------------------------------------------

        if requested_stat:

            required_stat = requested_stat


            # ----------------------------------------------------
            # 当前 Planet v0.1 只有一个 required_stat。
            #
            # 如果玩家说的是“热”，但 Planet 的环境模型
            # 只有 radiation_resistance，
            # 不能拿辐射阈值冒充高温阈值。
            #
            # Fail Closed。
            # ----------------------------------------------------

            if (
                planet_required_stat
                != requested_stat
            ):

                return json_output({
                    "status":
                        "error",

                    "error_code":
                        "ENVIRONMENT_REQUIREMENT_NOT_FOUND",

                    "message":
                        "Current planet does not contain "
                        "a matching environment requirement.",

                    "requested_stat":
                        requested_stat,

                    "current_planet_id":
                        current_planet_id,

                    "planet_required_stat":
                        planet_required_stat
                })


        # --------------------------------------------------------
        # 如果用户只说：
        #
        # “这里一直掉血怎么办？”
        #
        # Intent Resolver 没有可靠识别具体危险，
        # 则使用当前 Planet 的主环境危险。
        # --------------------------------------------------------

        else:

            required_stat = (
                planet_required_stat
            )


        required_value = to_number(
            target_planet.get(
                "required_value"
            )
        )


        recommended_value = to_number(
            target_planet.get(
                "recommended_value"
            )
        )


        requirement_source = (
            "current_planet_environment"
        )


        environment_scope = "planet"


        resolution_warnings.append(
            "Current environment is temporarily "
            "resolved from current planet because "
            "Zone data is not yet available."
        )


    # ------------------------------------------------------------
    # C1. 明确要求 Gene Upgrade
    # ------------------------------------------------------------

    elif (
        intent == "gene_upgrade"
        and requested_stat
    ):

        required_stat = requested_stat

        requirement_source = (
            "explicit_stat"
        )

        # Gene Upgrade 不存在环境门槛。
        required_value = None
        recommended_value = None

    # ------------------------------------------------------------
    # D. “当前任务”
    # ------------------------------------------------------------

    elif (
        use_active_mission
        or intent == "current_mission_preparation"
    ):

        mission = mission_map.get(
            active_mission_id
        )

        if not mission:

            return json_output({
                "status": "error",
                "error_code":
                    "ACTIVE_MISSION_NOT_FOUND",
                "message":
                    "Player has no valid active mission."
            })


        mission_planet_id = mission.get(
            "target_planet_id"
        )

        target_planet = planet_map.get(
            mission_planet_id
        )


        mission_creature_id = mission.get(
            "target_creature_id"
        )

        if mission_creature_id:

            target_creature = creature_map.get(
                mission_creature_id
            )


        required_stat = mission.get(
            "required_stat"
        )

        required_value = to_number(
            mission.get(
                "required_value"
            )
        )

        recommended_value = to_number(
            mission.get(
                "recommended_value"
            )
        )

        requirement_source = "active_mission"


    # ------------------------------------------------------------
    # E. Intent Resolver 无法识别时的安全 fallback
    # ------------------------------------------------------------

    else:

        mission = mission_map.get(
            active_mission_id
        )

        if mission:

            target_planet = planet_map.get(
                mission.get(
                    "target_planet_id"
                )
            )

            mission_creature_id = mission.get(
                "target_creature_id"
            )

            if mission_creature_id:

                target_creature = creature_map.get(
                    mission_creature_id
                )


            required_stat = mission.get(
                "required_stat"
            )

            required_value = to_number(
                mission.get(
                    "required_value"
                )
            )

            recommended_value = to_number(
                mission.get(
                    "recommended_value"
                )
            )

            requirement_source = (
                "fallback_active_mission"
            )

            resolution_warnings.append(
                "Intent was unresolved; "
                "active mission was used as fallback."
            )


        else:

            target_planet = planet_map.get(
                current_planet_id
            )

            if not target_planet:

                return json_output({
                    "status": "error",
                    "error_code":
                        "TARGET_CONTEXT_NOT_FOUND",
                    "message":
                        "Neither mission nor planet "
                        "context could be resolved."
                })


            required_stat = target_planet.get(
                "required_stat"
            )

            required_value = to_number(
                target_planet.get(
                    "required_value"
                )
            )

            recommended_value = to_number(
                target_planet.get(
                    "recommended_value"
                )
            )

            requirement_source = (
                "fallback_current_planet"
            )

            resolution_warnings.append(
                "Intent was unresolved; "
                "current planet was used as fallback."
            )


    # ============================================================
    # 9. 显式 Creature 仅补充上下文
    # ============================================================

    if (
        explicit_target_creature_id
        and not target_creature
    ):

        explicit_creature = creature_map.get(
            explicit_target_creature_id
        )

        if explicit_creature:
            target_creature = explicit_creature


    # ============================================================
    # 10. 验证 Required Stat
    # ============================================================

    if required_stat not in allowed_stats:

        return json_output({
            "status": "error",
            "error_code":
                "UNSUPPORTED_REQUIRED_STAT",
            "message":
                "Required stat could not be resolved.",
            "required_stat":
                required_stat
        })


    if required_stat not in player:

        return json_output({
            "status": "error",
            "error_code":
                "PLAYER_STAT_MISSING",
            "message":
                "Player does not contain the required stat.",
            "required_stat":
                required_stat
        })


    current_value = to_number(
        player.get(
            required_stat
        )
    )


    # ============================================================
    # 11. 当前状态判断
    # ============================================================

    is_gene_upgrade = (
        intent == "gene_upgrade"
    )


    if is_gene_upgrade:

        current_status = "upgrade_query"

    else:

        # 数据保护：
        # 推荐值不应小于最低值。
        if recommended_value < required_value:

            recommended_value = required_value

            resolution_warnings.append(
                "recommended_value was lower than "
                "required_value and was normalized."
            )


        current_status = get_status(
            current_value,
            required_value,
            recommended_value
        )


    # ============================================================
    # 12. 基因候选
    # ============================================================

    gene_candidates = []
    excluded_gene_candidates = []


    for gene in genes:

        if not isinstance(gene, dict):
            continue


        # 只处理当前 Required Stat 对应的 Gene
        if gene.get(
            "gene_type"
        ) != required_stat:

            continue


        bonus = to_number(
            gene.get(
                "bonus"
            )
        )

        stock = to_int(
            gene.get(
                "stock"
            )
        )

        available = to_bool(
            gene.get(
                "available"
            ),
            True
        )


        source_species_id = gene.get(
            "source_species_id"
        )

        source_creature = creature_map.get(
            source_species_id,
            {}
        )


        enriched_gene = {

            "gene_id":
                gene.get(
                    "gene_id",
                    gene.get("id")
                ),

            "gene_type":
                gene.get(
                    "gene_type"
                ),

            "gene_name":
                gene.get(
                    "gene_name"
                ),

            "bonus":
                bonus,

            "improvement":
                bonus - current_value,

            "source_species_id":
                source_species_id,

            "source_species_name":
                source_creature.get(
                    "species_name"
                ),

            "rarity":
                gene.get(
                    "rarity"
                ),

            "stock":
                stock,

            "available":
                available,

            "collector":
                gene.get(
                    "collector"
                ),

            "side_effect_type":
                gene.get(
                    "side_effect_type",
                    "none"
                ),

            "side_effect_value":
                to_number(
                    gene.get(
                        "side_effect_value",
                        0
                    )
                )
        }


        # --------------------------------------------------------
        # Gene 排除规则
        # --------------------------------------------------------

        reasons = []


        if not available:
            reasons.append(
                "unavailable"
            )


        if stock <= 0:
            reasons.append(
                "out_of_stock"
            )


        # Gene 是替换，不是叠加。
        # 新值必须高于当前玩家值。
        if bonus <= current_value:
            reasons.append(
                "no_improvement"
            )


        if reasons:

            enriched_gene[
                "excluded_reasons"
            ] = reasons

            excluded_gene_candidates.append(
                enriched_gene
            )

        else:

            gene_candidates.append(
                enriched_gene
            )


    # 数值高的先排列。
    # 注意：这不是“最终推荐排名”。
    gene_candidates.sort(
        key=lambda x: x["bonus"],
        reverse=True
    )


    # ============================================================
    # 13. 装备候选
    # ============================================================

    equipment_candidates = []


    for item in equipment:

        if not isinstance(item, dict):
            continue


        if item.get(
            "effect_type"
        ) != required_stat:

            continue


        stock = to_int(
            item.get(
                "stock"
            )
        )


        if stock <= 0:
            continue


        equipment_candidates.append({

            "equipment_id":
                item.get(
                    "equipment_id",
                    item.get("id")
                ),

            "equipment_name":
                item.get(
                    "equipment_name"
                ),

            "effect_type":
                item.get(
                    "effect_type"
                ),

            "effect_bonus":
                to_number(
                    item.get(
                        "effect_bonus"
                    )
                ),

            "energy_cost":
                to_number(
                    item.get(
                        "energy_cost"
                    )
                ),

            "stock":
                stock,

            "rarity":
                item.get(
                    "rarity"
                )
        })


    # ============================================================
    # 14. 计算方案
    # ============================================================

    calculated_options = []


    # ============================================================
    # gene_upgrade：
    #
    # 玩家只是在问：
    # “有没有更好的耐高温基因？”
    #
    # 此时没有 required / recommended 环境门槛，
    # 所以不能生成 misleading 的环境状态。
    # ============================================================

    if is_gene_upgrade:

        # 当前状态
        calculated_options.append({

            "option_type":
                "current",

            "gene_id":
                None,

            "gene_name":
                None,

            "equipment_id":
                None,

            "equipment_name":
                None,

            "effective_value":
                current_value,

            "improvement":
                0,

            "status":
                "current",

            "energy_cost":
                0,

            "side_effects":
                []
        })


        # Gene-only Upgrade
        for gene in gene_candidates:

            effects = []

            if (
                gene[
                    "side_effect_type"
                ] != "none"
            ):

                effects.append({

                    "type":
                        gene[
                            "side_effect_type"
                        ],

                    "value":
                        gene[
                            "side_effect_value"
                        ]
                })


            calculated_options.append({

                "option_type":
                    "gene_only",

                "gene_id":
                    gene["gene_id"],

                "gene_name":
                    gene["gene_name"],

                "source_species_name":
                    gene[
                        "source_species_name"
                    ],

                "equipment_id":
                    None,

                "equipment_name":
                    None,

                "effective_value":
                    gene["bonus"],

                "improvement":
                    gene["bonus"]
                    - current_value,

                "status":
                    "better_than_current",

                "energy_cost":
                    0,

                "side_effects":
                    effects
            })


    # ============================================================
    # Mission / Planet Preparation：
    #
    # 存在 required / recommended，
    # 可以完整计算当前、Gene、Equipment、组合方案。
    # ============================================================

    else:

        # --------------------------------------------------------
        # A. 当前状态，不修改
        # --------------------------------------------------------

        calculated_options.append({

            "option_type":
                "current",

            "gene_id":
                None,

            "gene_name":
                None,

            "equipment_id":
                None,

            "equipment_name":
                None,

            "effective_value":
                current_value,

            "status":
                get_status(
                    current_value,
                    required_value,
                    recommended_value
                ),

            "meets_required":
                current_value
                >= required_value,

            "meets_recommended":
                current_value
                >= recommended_value,

            "energy_cost":
                0,

            "side_effects":
                []
        })


        # --------------------------------------------------------
        # B. Gene Only
        #
        # Gene 是替换：
        # 18 → 42
        # 结果就是 42，不是 18 + 42。
        # --------------------------------------------------------

        for gene in gene_candidates:

            effective = gene["bonus"]

            effects = []

            if (
                gene[
                    "side_effect_type"
                ] != "none"
            ):

                effects.append({

                    "type":
                        gene[
                            "side_effect_type"
                        ],

                    "value":
                        gene[
                            "side_effect_value"
                        ]
                })


            calculated_options.append({

                "option_type":
                    "gene_only",

                "gene_id":
                    gene["gene_id"],

                "gene_name":
                    gene["gene_name"],

                "source_species_name":
                    gene[
                        "source_species_name"
                    ],

                "equipment_id":
                    None,

                "equipment_name":
                    None,

                "effective_value":
                    effective,

                "status":
                    get_status(
                        effective,
                        required_value,
                        recommended_value
                    ),

                "meets_required":
                    effective
                    >= required_value,

                "meets_recommended":
                    effective
                    >= recommended_value,

                "energy_cost":
                    0,

                "side_effects":
                    effects
            })


        # --------------------------------------------------------
        # C. 当前 Gene + Equipment
        #
        # Equipment 可以叠加。
        # --------------------------------------------------------

        for item in equipment_candidates:

            effective = (
                current_value
                + item[
                    "effect_bonus"
                ]
            )


            calculated_options.append({

                "option_type":
                    "equipment_only",

                "gene_id":
                    None,

                "gene_name":
                    None,

                "equipment_id":
                    item[
                        "equipment_id"
                    ],

                "equipment_name":
                    item[
                        "equipment_name"
                    ],

                "effective_value":
                    effective,

                "status":
                    get_status(
                        effective,
                        required_value,
                        recommended_value
                    ),

                "meets_required":
                    effective
                    >= required_value,

                "meets_recommended":
                    effective
                    >= recommended_value,

                "energy_cost":
                    item[
                        "energy_cost"
                    ],

                "side_effects":
                    []
            })


        # --------------------------------------------------------
        # D. 新 Gene + Equipment
        # --------------------------------------------------------

        for gene in gene_candidates:

            for item in equipment_candidates:

                effective = (
                    gene["bonus"]
                    + item[
                        "effect_bonus"
                    ]
                )

                effects = []

                if (
                    gene[
                        "side_effect_type"
                    ] != "none"
                ):

                    effects.append({

                        "type":
                            gene[
                                "side_effect_type"
                            ],

                        "value":
                            gene[
                                "side_effect_value"
                            ]
                    })


                calculated_options.append({

                    "option_type":
                        "gene_plus_equipment",

                    "gene_id":
                        gene["gene_id"],

                    "gene_name":
                        gene[
                            "gene_name"
                        ],

                    "source_species_name":
                        gene[
                            "source_species_name"
                        ],

                    "equipment_id":
                        item[
                            "equipment_id"
                        ],

                    "equipment_name":
                        item[
                            "equipment_name"
                        ],

                    "effective_value":
                        effective,

                    "status":
                        get_status(
                            effective,
                            required_value,
                            recommended_value
                        ),

                    "meets_required":
                        effective
                        >= required_value,

                    "meets_recommended":
                        effective
                        >= recommended_value,

                    "energy_cost":
                        item[
                            "energy_cost"
                        ],

                    "side_effects":
                        effects
                })


    # ============================================================
    # 15. 汇总可行方案
    # ============================================================

    if is_gene_upgrade:

        viable_options = []

        recommended_options = []

    else:

        viable_options = [
            x
            for x in calculated_options
            if x.get(
                "meets_required",
                False
            )
        ]

        recommended_options = [
            x
            for x in calculated_options
            if x.get(
                "meets_recommended",
                False
            )
        ]


    # ============================================================
    # 16. Decision
    # ============================================================

    if is_gene_upgrade:

        decision = {

            "decision_type":
                "gene_upgrade",

            "current_status":
                "upgrade_query",

            "needs_upgrade":
                len(
                    gene_candidates
                ) > 0,

            "better_gene_available":
                len(
                    gene_candidates
                ) > 0,

            "better_gene_count":
                len(
                    gene_candidates
                ),

            "current_value":
                current_value,

            "best_available_gene_value":
                (
                    gene_candidates[0][
                        "bonus"
                    ]
                    if gene_candidates
                    else None
                )
        }


    else:

        decision = {

            "decision_type":
                "environment_preparation",

            "current_status":
                current_status,

            "needs_upgrade":
                current_value
                < required_value,

            "meets_required":
                current_value
                >= required_value,

            "meets_recommended":
                current_value
                >= recommended_value,

            "viable_option_count":
                len(
                    viable_options
                ),

            "recommended_option_count":
                len(
                    recommended_options
                )
        }


    # ============================================================
    # 17. Lore Router
    #
    # 根据本轮已经确定的 Decision Context，决定需要查询哪些
    # Sprite AI Lore KB 静态知识。
    #
    # 设计原则：
    # - lore_key 由确定性 Code 生成，不由 LLM 猜测。
    # - 动态事实仍以 JSON Server / Decision Context 为准。
    # - Lore 只负责解释世界观、生态、机制和副作用含义。
    # ============================================================

    lore_requests = []
    added_lore_keys = set()


    # ------------------------------------------------------------
    # Side Effect Type -> Lore Key
    # ------------------------------------------------------------

    side_effect_lore_map = {
        "energy_drain":
            "effect_energy_drain",

        "health_regen":
            "effect_health_regen",

        "stamina_recovery":
            "effect_stamina_recovery",

        "agility":
            "effect_agility"
    }


    def add_lore_request(
        lore_key,
        reason,
        priority,
        entity_id=None,
        title=None
    ):
        """
        添加一条 Lore 查询请求，并按 lore_key 去重。
        """

        if not lore_key:
            return

        if lore_key in added_lore_keys:
            return

        added_lore_keys.add(
            lore_key
        )

        lore_requests.append({
            "lore_key":
                lore_key,

            "reason":
                reason,

            "priority":
                priority,

            "entity_id":
                entity_id,

            "title":
                title
        })


    # ============================================================
    # A. 目标星球 Lore
    # ============================================================

    if target_planet:

        add_lore_request(
            lore_key=
                target_planet.get(
                    "lore_key"
                ),

            reason=
                "target_planet",

            priority=
                100,

            entity_id=
                target_planet.get(
                    "planet_id"
                ),

            title=
                target_planet.get(
                    "planet_name"
                )
        )


    # ============================================================
    # B. 目标生物 Lore
    # ============================================================

    if target_creature:

        add_lore_request(
            lore_key=
                target_creature.get(
                    "lore_key"
                ),

            reason=
                "target_creature",

            priority=
                95,

            entity_id=
                target_creature.get(
                    "creature_id"
                ),

            title=
                target_creature.get(
                    "species_name"
                )
        )


    # ============================================================
    # C. 确定本轮真正值得补充 Lore 的 Gene
    #
    # gene_upgrade：
    #   取排名前 3 的可升级 Gene。
    #
    # mission / planet preparation：
    #   如果玩家尚未达到 recommended，优先从达到 recommended
    #   的方案中选 Gene，再从 viable 方案补足。
    #
    # 玩家当前已经达到 recommended 时，不为了推荐而额外拉取
    # Gene Lore。
    # ============================================================

    relevant_gene_ids = []


    def append_gene_id(gene_id):

        if not gene_id:
            return

        if gene_id in relevant_gene_ids:
            return

        relevant_gene_ids.append(
            gene_id
        )


    if is_gene_upgrade:

        for gene in gene_candidates[:3]:

            append_gene_id(
                gene.get(
                    "gene_id"
                )
            )


    elif not decision.get(
        "meets_recommended",
        False
    ):

        # --------------------------------------------------------
        # 先从 recommended 方案取 Gene
        # --------------------------------------------------------

        for option in recommended_options:

            append_gene_id(
                option.get(
                    "gene_id"
                )
            )

            if len(
                relevant_gene_ids
            ) >= 3:
                break


        # --------------------------------------------------------
        # 不足 3 个时，再从 viable 方案补
        # --------------------------------------------------------

        if len(
            relevant_gene_ids
        ) < 3:

            for option in viable_options:

                append_gene_id(
                    option.get(
                        "gene_id"
                    )
                )

                if len(
                    relevant_gene_ids
                ) >= 3:
                    break


        # --------------------------------------------------------
        # 如果还没有 Gene，则退回候选列表
        # --------------------------------------------------------

        if not relevant_gene_ids:

            for gene in gene_candidates[:3]:

                append_gene_id(
                    gene.get(
                        "gene_id"
                    )
                )


    # ============================================================
    # D. Gene ID -> Gene Candidate Map
    # ============================================================

    gene_candidate_map = {
        gene.get(
            "gene_id"
        ): gene
        for gene in gene_candidates
    }


    # ============================================================
    # E. Gene 来源生物 Lore + Gene 副作用 Lore
    # ============================================================

    for gene_id in relevant_gene_ids:

        gene = gene_candidate_map.get(
            gene_id
        )

        if not gene:
            continue


        # --------------------------------------------------------
        # Gene 来源生物
        # --------------------------------------------------------

        source_species_id = gene.get(
            "source_species_id"
        )

        source_creature = creature_map.get(
            source_species_id
        )


        if source_creature:

            add_lore_request(
                lore_key=
                    source_creature.get(
                        "lore_key"
                    ),

                reason=
                    "gene_source",

                priority=
                    80,

                entity_id=
                    source_species_id,

                title=
                    source_creature.get(
                        "species_name"
                    )
            )


        # --------------------------------------------------------
        # Gene 副作用
        # --------------------------------------------------------

        side_effect_type = gene.get(
            "side_effect_type"
        )

        if (
            side_effect_type
            and side_effect_type != "none"
        ):

            effect_lore_key = (
                side_effect_lore_map.get(
                    side_effect_type
                )
            )

            add_lore_request(
                lore_key=
                    effect_lore_key,

                reason=
                    "gene_side_effect",

                priority=
                    75,

                entity_id=
                    side_effect_type,

                title=
                    side_effect_type
            )


    # ============================================================
    # F. 基因替换 / 装备叠加规则 Lore
    #
    # gene_upgrade 一定涉及基因替换规则。
    #
    # 环境准备场景中，只有玩家尚未达到 recommended，且本轮存在
    # equipment_only / gene_plus_equipment 方案时才加载该规则，
    # 避免玩家已经足够强时仍无意义地解释强化机制。
    # ============================================================

    needs_gene_equipment_rule = (
        is_gene_upgrade
    )


    if (
        not needs_gene_equipment_rule
        and not decision.get(
            "meets_recommended",
            False
        )
    ):

        for option in calculated_options:

            if option.get(
                "option_type"
            ) in (
                "equipment_only",
                "gene_plus_equipment"
            ):

                needs_gene_equipment_rule = True
                break


    if needs_gene_equipment_rule:

        add_lore_request(
            lore_key=
                "rule_gene_equipment_interaction",

            reason=
                "game_rule",

            priority=
                60,

            entity_id=
                "RULE001",

            title=
                "基因替换与装备叠加规则"
        )


    # ============================================================
    # G. Lore Request 排序与 Key List
    # ============================================================

    lore_requests.sort(
        key=lambda x: x[
            "priority"
        ],
        reverse=True
    )


    lore_keys = [
        item[
            "lore_key"
        ]
        for item in lore_requests
    ]


    # ============================================================
    # 18. 最终统一 Sprite AI Context
    # ============================================================

    result = {

        "status":
            "success",


        # --------------------------------------------------------
        # Intent Resolver 的真实输出
        # 不再写死 planet_preparation / PL002
        # --------------------------------------------------------

        "intent_resolution": {

            "intent":
                intent,

            "confidence":
                confidence,

            "target_mission_id":
                target_mission_id,

            "target_planet_id":
                target_planet_id,

            "target_creature_id":
                explicit_target_creature_id,

            "requested_stat":
                requested_stat,

            "use_active_mission":
                use_active_mission,

            "resolution_source":
                requirement_source,

            "warnings":
                resolution_warnings
        },


        # --------------------------------------------------------
        # 玩家状态
        # --------------------------------------------------------

        "player_state": {

            "player_id":
                player_id,

            "player_name":
                player.get(
                    "player_name"
                ),

            "level":
                player.get(
                    "level"
                ),

            "hp":
                player.get(
                    "hp"
                ),

            "energy":
                player.get(
                    "energy"
                ),

            "current_planet_id":
                current_planet_id,

            "active_mission_id":
                active_mission_id,

            "required_stat":
                required_stat,

            "current_stat_value":
                current_value
        },

        "knowledge_scope":
            knowledge_scope,

        # --------------------------------------------------------
        # 当前任务 / 环境
        # --------------------------------------------------------

        "target_context": {

            "requirement_source":
                requirement_source,
                
            "environment_scope":
                environment_scope,                

            "mission_id":
                (
                    mission.get(
                        "mission_id"
                    )
                    if mission
                    else None
                ),

            "mission_name":
                (
                    mission.get(
                        "mission_name"
                    )
                    if mission
                    else None
                ),

            "planet_id":
                (
                    target_planet.get(
                        "planet_id"
                    )
                    if target_planet
                    else None
                ),

            "planet_name":
                (
                    target_planet.get(
                        "planet_name"
                    )
                    if target_planet
                    else None
                ),

            "primary_hazard":
                (
                    target_planet.get(
                        "primary_hazard"
                    )
                    if target_planet
                    else None
                ),

            "target_creature_id":
                (
                    target_creature.get(
                        "creature_id"
                    )
                    if target_creature
                    else None
                ),

            "target_creature_name":
                (
                    target_creature.get(
                        "species_name"
                    )
                    if target_creature
                    else None
                ),

            "required_stat":
                required_stat,

            "required_value":
                required_value,

            "recommended_value":
                recommended_value
        },


        # --------------------------------------------------------
        # 候选资源
        # --------------------------------------------------------

        "gene_candidates":
            gene_candidates,

        "excluded_gene_candidates":
            excluded_gene_candidates,

        "equipment_candidates":
            equipment_candidates,


        # --------------------------------------------------------
        # Code 已经完成的确定性计算
        # --------------------------------------------------------

        "calculated_options":
            calculated_options,


        # --------------------------------------------------------
        # 最终确定性判断
        # --------------------------------------------------------

        "decision":
            decision,


        # --------------------------------------------------------
        # 本轮需要从 Sprite AI Lore KB 查询的知识
        # --------------------------------------------------------

        "lore_requests":
            lore_requests,

        "lore_keys":
            lore_keys
    }


    # ============================================================
    # 19. RAGFlow Code 节点统一返回 String
    # ============================================================

    return json_output(
        result
    )
