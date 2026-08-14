# -*- coding: utf-8 -*-
"""
术语抽取薄包装
========================================
从 stdin 读 JSON，调原脚本 _extract() + main()，输出 JSON 到 stdout。

调用契约：
  入参 (stdin):  {"source_text": "崇岳洞天乃是..."}
  出参 (stdout): {
    "glossary": "【必须遵守】...",
    "term_total": 7,
    "mandatory_count": 3,
    "preferred_count": 2,
    "hits": [{"zh": "崇岳洞天", "en": "...", "lv": "m", "forbidden": []}, ...]
  }

设计说明：
  原脚本 main() 只返回 glossary 文本 + 计数，不返回命中明细。
  本 wrapper 额外调 _extract() 拿命中明细，方便前端右侧面板逐条展示。
  两份调用共享 _AUTOMATON 全局缓存，无重复构造开销。
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


def run(source_text: str) -> dict:
    text = source_text or ""
    if not text.strip():
        return {
            "glossary": "",
            "term_total": 0,
            "mandatory_count": 0,
            "preferred_count": 0,
            "hits": [],
        }

    # 拿命中明细
    found, _counts = _mod._extract(text)
    hits = [
        {
            "zh": rec["zh"],
            "en": rec["en"],
            "lv": rec["lv"],
            "forbidden": rec.get("forbidden", []),
        }
        for rec in found
    ]

    # 拿拼好的 glossary 文本 + 计数（与 hits 共享 _AUTOMATON 缓存）
    base = _mod.main(text)

    return {
        "glossary": base["glossary"],
        "term_total": base["term_total"],
        "mandatory_count": base["mandatory_count"],
        "preferred_count": base["preferred_count"],
        "hits": hits,
    }


if __name__ == "__main__":
    # 用 utf-8-sig 兼容 PowerShell stdin 的 UTF-8 BOM
    raw_bytes = sys.stdin.buffer.read()
    raw = raw_bytes.decode("utf-8-sig", errors="replace")
    # 兜底：去掉残留的 BOM 字符
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
    result = run(source_text)
    json.dump(result, sys.stdout, ensure_ascii=False)
