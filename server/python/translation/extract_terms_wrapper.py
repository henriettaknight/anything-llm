# -*- coding: utf-8 -*-
"""
术语抽取薄包装（多词库融合版）
========================================
从 stdin 读 JSON，调原脚本的 _extract/main，输出 JSON 到 stdout。

调用契约：
  入参 (stdin):  {
    "source_text": "崇岳洞天乃是...",
    "glossary_ids": ["default", "xianxia-v2", "fantasy"]
  }
  出参 (stdout): {
    "glossary": "【必须遵守】...",
    "term_total": 7,
    "mandatory_count": 3,
    "preferred_count": 2,
    "hits": [{"zh": "崇岳洞天", "en": "...", "lv": "m", "forbidden": []}, ...],
    "all_terms": ["崇岳洞天", "神识负载", ...],
    "glossary_used": ["default", "xianxia-v2"]
  }

设计说明：
  - default 词库：原脚本内联 _GLOSSARY，Aho-Corasick 自动机硬编码
  - 扩展词库：server/storage/glossaries/*.jsonl
      每行 JSON：{"src": "灵力", "tgt": "Spiritual Power",
                 "type": "mandatory"|"preferred"|"restricted",
                 "variants": ["灵气"], "forbidden": ["Reiki"]}
  - 融合规则：按 glossary_ids 顺序加载，**靠后的覆盖靠前的**
      即同一 zh 主词条，后加载的词库的 en/lv/forbidden 覆盖先加载的
  - default 始终在数组第一位（前端默认勾选），不可移除位置（但可以被覆盖）
  - jsonl 找不到或解析失败时跳过，不影响其他词库
"""
import json
import sys
import importlib.util
from pathlib import Path

# 原脚本文件名含中文 + 下划线，用 importlib 动态加载
_spec = importlib.util.spec_from_file_location(
    "term_extractor",
    str(Path(__file__).parent / "ragflow_code_组件_术语抽取.py")
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


# 扩展词库目录：server/storage/glossaries/
_GLOSSARY_DIR = Path(__file__).resolve().parent.parent.parent / "storage" / "glossaries"


def _load_jsonl(file_path: Path) -> list:
    """读取 jsonl 词库文件，返回 [{zh, en, lv, variants, forbidden}, ...]"""
    records = []
    if not file_path.exists():
        return records
    try:
        with open(file_path, "r", encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                src = obj.get("src") or obj.get("zh") or ""
                tgt = obj.get("tgt") or obj.get("en") or ""
                if not src or not tgt:
                    continue
                typ = (obj.get("type") or "preferred").lower()
                lv = "m" if "mandatory" in typ or typ == "must" else (
                    "r" if "restricted" in typ or "forbidden" in typ else "p"
                )
                variants = obj.get("variants") or []
                if isinstance(variants, str):
                    variants = [v for v in variants.split("|") if v]
                forbidden = obj.get("forbidden") or []
                if isinstance(forbidden, str):
                    forbidden = [v for v in forbidden.split("|") if v]
                records.append({
                    "zh": src,
                    "en": tgt,
                    "lv": lv,
                    "variants": variants,
                    "forbidden": forbidden,
                })
    except Exception:
        pass
    return records


def _id_to_jsonl_path(glossary_id: str) -> Path:
    """glossary_id 反查 jsonl 文件路径（与 glossaryManager.safeId 算法一致）"""
    # safeId: toLowerCase, replace .jsonl, [^a-z0-9_-] -> '-', collapse, trim
    candidates = []
    if not _GLOSSARY_DIR.exists():
        return None
    for entry in _GLOSSARY_DIR.iterdir():
        if not entry.is_file() or not entry.name.endswith(".jsonl"):
            continue
        sid = entry.name.lower().replace(".jsonl", "")
        sid = "".join(c if c in "abcdefghijklmnopqrstuvwxyz0123456789_-" else "-" for c in sid)
        while "--" in sid:
            sid = sid.replace("--", "-")
        sid = sid.strip("-")
        if sid == glossary_id:
            candidates.append(entry)
    return candidates[0] if candidates else None


def _build_merged_glossary_lines(glossary_ids):
    """
    按 glossary_ids 顺序加载词库，融合成 _GLOSSARY 格式的字符串。
    靠后的覆盖靠前的（同一 zh 主词条，后加载的覆盖先加载的）。
    返回 (merged_lines, used_ids)
    """
    # 用 dict 保存 zh -> line，后加载的覆盖先加载的
    merged = {}  # zh -> "zh;;en;;lv;;variants;;forbidden"

    used_ids = []

    for gid in glossary_ids or []:
        if gid == "default":
            # 内置词库
            for line in _mod._GLOSSARY.split("\n"):
                line = line.rstrip("\r")
                if not line:
                    continue
                parts = line.split(";;")
                if len(parts) != 5:
                    continue
                zh = parts[0]
                merged[zh] = line
            used_ids.append("default")
        else:
            # jsonl 词库
            jsonl_path = _id_to_jsonl_path(gid)
            if jsonl_path is None:
                continue
            records = _load_jsonl(jsonl_path)
            if not records:
                continue
            for rec in records:
                zh = rec["zh"]
                en = rec["en"]
                lv = rec["lv"]
                variants = "|".join(rec.get("variants", []))
                forbidden = "|".join(rec.get("forbidden", []))
                line = f"{zh};;{en};;{lv};;{variants};;{forbidden}"
                merged[zh] = line  # 覆盖
            used_ids.append(gid)

    return list(merged.values()), used_ids


def _build_automaton_from_lines(lines):
    """从融合后的 _GLOSSARY 行列表构建 Aho-Corasick 自动机"""
    ac = _mod._AC()
    for line in lines:
        line = line.rstrip("\r")
        if not line:
            continue
        parts = line.split(";;")
        if len(parts) != 5:
            continue
        zh, en, lv, variants, forbidden = parts
        rec = {
            "zh": zh,
            "en": en,
            "lv": lv,
            "forbidden": [x for x in forbidden.split("|") if x],
        }
        for head in [zh] + [x for x in variants.split("|") if x]:
            if len(head) >= 2:
                ac.add(head, rec)
    ac.build()
    return ac


def run(source_text: str, glossary_ids=None) -> dict:
    text = source_text or ""
    if not text.strip():
        return {
            "glossary": "",
            "term_total": 0,
            "mandatory_count": 0,
            "preferred_count": 0,
            "hits": [],
            "all_terms": [],
            "glossary_used": [],
        }

    # 1. 融合词库
    if not glossary_ids:
        glossary_ids = ["default"]
    merged_lines, used_ids = _build_merged_glossary_lines(glossary_ids)

    # 2. 构建融合后的自动机（不污染原脚本 _AUTOMATON 全局缓存）
    ac = _build_automaton_from_lines(merged_lines)

    # 3. 抽取命中明细（复制 _extract 逻辑但用本地 ac）
    hits_found = sorted(ac.find(text), key=lambda h: (h[0], -(h[1] - h[0])))
    seen, order, max_end = {}, [], -1
    for s, e, rec in hits_found:
        if e <= max_end:
            continue
        max_end = e
        key = rec["zh"]
        if key not in seen:
            seen[key] = 0
            order.append(rec)
        seen[key] += 1
    hits = [
        {
            "zh": rec["zh"],
            "en": rec["en"],
            "lv": rec["lv"],
            "forbidden": rec.get("forbidden", []),
        }
        for rec in order
    ]

    # 4. 拼 glossary 文本（直接复制 _mod.main 的拼装逻辑，但用本地 hits）
    buckets = {"m": [], "p": [], "r": []}
    for rec in order:
        buckets.get(rec["lv"], buckets["p"]).append(rec)

    out = []
    if buckets["m"]:
        out.append("【必须遵守】以下概念在译文中必须且只能使用「规定译法」，"
                   "括号内的禁用译法一律不得使用：")
        out.append("")
        for r in buckets["m"]:
            line = "- " + r["zh"] + " -> " + r["en"]
            if r["forbidden"]:
                line += "（禁用：" + "、".join(r["forbidden"]) + "）"
            out.append(line)
        out.append("")
    if buckets["p"]:
        out.append("【优先使用】以下译法为首选，允许按语法需要作单复数、时态、词形调整，"
                   "但不得改用其他说法：")
        out.append("")
        for r in buckets["p"]:
            line = "- " + r["zh"] + " -> " + r["en"]
            if r["forbidden"]:
                line += "（禁用：" + "、".join(r["forbidden"]) + "）"
            out.append(line)
        out.append("")
    if buckets["r"]:
        out.append("【参考释义】以下仅供理解原文，译法不作强制要求：")
        out.append("")
        for r in buckets["r"]:
            out.append("- " + r["zh"] + "：" + r["en"])

    glossary_text = "\n".join(out)

    # 5. all_terms：从 merged_lines 提取所有主词条 zh
    all_terms = []
    for line in merged_lines:
        line = line.rstrip("\r")
        if not line:
            continue
        parts = line.split(";;")
        if len(parts) != 5:
            continue
        zh = parts[0]
        if zh and zh not in all_terms:
            all_terms.append(zh)

    return {
        "glossary": glossary_text,
        "term_total": len(hits),
        "mandatory_count": sum(1 for h in hits if h["lv"] == "m"),
        "preferred_count": sum(1 for h in hits if h["lv"] == "p"),
        "hits": hits,
        "all_terms": all_terms,
        "glossary_used": used_ids,
    }


if __name__ == "__main__":
    # 用 utf-8-sig 兼容 PowerShell stdin 的 UTF-8 BOM
    raw_bytes = sys.stdin.buffer.read()
    raw = raw_bytes.decode("utf-8-sig", errors="replace")
    raw = raw.replace("\ufeff", "").lstrip()
    if not raw.strip():
        json.dump({"error": "empty stdin"}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        json.dump({"error": f"invalid json: {e}"}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
    source_text = payload.get("source_text", "")
    glossary_ids = payload.get("glossary_ids") or ["default"]
    result = run(source_text, glossary_ids)
    json.dump(result, sys.stdout, ensure_ascii=False)
