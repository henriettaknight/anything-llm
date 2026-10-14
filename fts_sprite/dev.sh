#!/usr/bin/env bash
# FTS 精灵本地开发启动脚本（由根目录 yarn dev:fts_sprite / yarn dev:all 调用）
#
# - 首次运行时创建独立虚拟环境并安装依赖，不会改动当前激活的 conda / venv / 系统 Python。
# - 虚拟环境默认放在 ~/.venvs/fts_sprite（本机 Linux 文件系统），可用 FTS_SPRITE_VENV 修改。
#   不放在仓库目录里：仓库若位于 /media 下的 NTFS/exFAT 盘或网络共享，可能无法创建符号链接。
# - 系统 Python 缺少 ensurepip（未安装 python3.x-venv）时，自动改用
#   「--without-pip 创建 + 用当前环境的 pip 安装到虚拟环境」，无需 sudo。
# - requirements.txt 有变化时自动重新安装。
# - 可用 FTS_SPRITE_PYTHON 指定用来创建虚拟环境的 Python（默认 python3）。
set -euo pipefail
# 任何未预期的失败都打印行号，避免脚本静默退出
trap 'echo "[fts_sprite] ERROR: dev.sh 第 $LINENO 行执行失败（code $?），精灵服务未启动" >&2' ERR

cd "$(dirname "$0")"

# 配置文件：与 Node 开发模式一致，优先 server/.env.development，其次 server/.env
# （Node 的 yarn dev 设置了 NODE_ENV=development，只读 .env.development）
SERVER_DIR="$(cd .. && pwd)/server"
if [ -z "${FTS_SPRITE_ENV_FILE:-}" ]; then
  export FTS_SPRITE_ENV_FILE="$SERVER_DIR/.env.development:$SERVER_DIR/.env"
fi

# 未在 shell 中设置时，从上述文件读取端口 / 地址（与 Node 侧 FTS_SPRITE_SERVICE_URL 保持一致）
read_env() {
  local f v
  IFS=':' read -ra _files <<< "$FTS_SPRITE_ENV_FILE"
  for f in "${_files[@]}"; do
    [ -f "$f" ] || continue
    # 找不到该变量时 grep 返回非 0，配合 set -e / pipefail 会让脚本静默退出，这里必须吞掉
    v="$({ grep -aE "^$1=" "$f" || true; } | tail -n1 | cut -d= -f2- | tr -d '"'"'"' \r')"
    if [ -n "$v" ]; then echo "$v"; return 0; fi
  done
  return 0
}
FTS_SPRITE_PORT="${FTS_SPRITE_PORT:-$(read_env FTS_SPRITE_PORT)}"
FTS_SPRITE_HOST="${FTS_SPRITE_HOST:-$(read_env FTS_SPRITE_HOST)}"
PORT="${FTS_SPRITE_PORT:-8890}"
HOST="${FTS_SPRITE_HOST:-127.0.0.1}"

VENV_DIR="${FTS_SPRITE_VENV:-$HOME/.venvs/fts_sprite}"
PY="$VENV_DIR/bin/python"
STAMP="$VENV_DIR/.requirements.sha"
BASE_PYTHON="${FTS_SPRITE_PYTHON:-python3}"

fail() {
  echo "[fts_sprite] ERROR: $*" >&2
  echo "[fts_sprite] 精灵服务未启动，聊天时会出现 ECONNREFUSED。" >&2
  exit 1
}

command -v "$BASE_PYTHON" >/dev/null 2>&1 || fail "找不到 $BASE_PYTHON，可用 FTS_SPRITE_PYTHON 指定 Python 路径"

# 安装依赖：虚拟环境自带 pip 时用它，否则借用 BASE_PYTHON 的 pip（pip --python，需 pip>=22.3）
pip_install() {
  if "$PY" -m pip --version >/dev/null 2>&1; then
    "$PY" -m pip install -q "$@"
  else
    "$BASE_PYTHON" -m pip --python "$PY" install -q "$@"
  fi
}

# 虚拟环境不存在或已损坏（例如上次创建到一半失败）时重建
if ! "$PY" -c "import sys" >/dev/null 2>&1; then
  echo "[fts_sprite] creating virtualenv at $VENV_DIR using $("$BASE_PYTHON" --version 2>&1) ($(command -v "$BASE_PYTHON"))"
  mkdir -p "$(dirname "$VENV_DIR")"
  if ! VENV_LOG="$("$BASE_PYTHON" -m venv --clear "$VENV_DIR" 2>&1)"; then
    echo "$VENV_LOG" | tail -n 5 | sed 's/^/[fts_sprite]   /'
    echo "[fts_sprite] python -m venv failed (usually ensurepip missing), retrying with --without-pip"
    "$BASE_PYTHON" -m venv --clear --without-pip "$VENV_DIR" \
      || fail "创建虚拟环境失败。可安装 venv 支持：sudo apt install python3-venv（或对应版本的 python3.x-venv）"
    "$BASE_PYTHON" -m pip --version >/dev/null 2>&1 \
      || fail "$BASE_PYTHON 没有可用的 pip，无法安装依赖。请安装 python3-venv 或用 FTS_SPRITE_PYTHON 指定带 pip 的 Python"
  fi
  rm -f "$STAMP"
fi

REQ_SHA="$(sha256sum requirements.txt | cut -d' ' -f1)"
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$REQ_SHA" ]; then
  echo "[fts_sprite] installing requirements into $VENV_DIR ..."
  pip_install -r requirements.txt || fail "依赖安装失败"
  echo "$REQ_SHA" > "$STAMP"
fi

echo "[fts_sprite] config files: ${FTS_SPRITE_ENV_FILE//:/ , }"
echo "[fts_sprite] starting on $HOST:$PORT"
exec "$PY" -m uvicorn main:app \
  --host "$HOST" \
  --port "$PORT" \
  --reload \
  --reload-exclude ".venv/*"
