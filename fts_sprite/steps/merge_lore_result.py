# -*- coding: utf-8 -*-
"""
Merge_Lore_Result：校验检索命中并合并到 lore_context

来源：RAGFlow 画布「FTS游戏精灵0.5」节点 CodeExec:TidyWingsPlay
本文件的 main() 与画布 Code 节点脚本保持一致（逐字迁移），
后续在 RAGFlow 中调整脚本时，可直接整体替换 main() 函数。
请勿在 main() 内加入 print：日志请使用 logging。
"""

def main(
    current_query: str,
    retrieval_content: str,
    accumulated_lore: str
) -> str:

    # ============================================================
    # 1. 基础保护
    # ============================================================

    if not accumulated_lore:
        accumulated_lore = ""


    if not current_query:
        return accumulated_lore


    if not retrieval_content:
        return accumulated_lore


    # ============================================================
    # 2. 当前请求的 lore_key
    #
    # Query 格式：
    #
    # lore_key title entity_id
    #
    # 所以第一个 token 就是 lore_key。
    # ============================================================

    requested_lore_key = (
        current_query
        .strip()
        .split()[0]
    )


    if not requested_lore_key:
        return accumulated_lore


    # ============================================================
    # 3. 验证 Retrieval 确实命中了当前 Lore
    #
    # 当前 Excel Chunk 中包含：
    #
    # lore_key: creature_core_behemoth
    # ============================================================

    expected_marker = (
        "lore_key: "
        + requested_lore_key
    )


    if (
        expected_marker.lower()
        not in retrieval_content.lower()
    ):

        # Retrieval 返回了错误 Chunk
        # 不把噪音加入 Lore Context

        return accumulated_lore


    # ============================================================
    # 4. 去重
    # ============================================================

    merge_marker = (
        "[[LORE:"
        + requested_lore_key
        + "]]"
    )


    if (
        merge_marker
        in accumulated_lore
    ):

        return accumulated_lore


    # ============================================================
    # 5. 合并
    # ============================================================

    new_block = (

        merge_marker
        + "\n"
        + retrieval_content.strip()
    )


    if accumulated_lore.strip():

        return (

            accumulated_lore.rstrip()
            + "\n\n"
            + new_block
        )


    return new_block
