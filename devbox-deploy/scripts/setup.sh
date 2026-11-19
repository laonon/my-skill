#!/usr/bin/env bash
# 一键初始化 devbox-deploy skill
#
#   bash scripts/setup.sh
#
# 做四件事：
#   1. 检查文件是否齐全（dvctl / ca.crt / .env.example）
#   2. 建 .env 并设成 600（已有则保留）
#   3. 没有令牌就引导你贴一枚（用如视账号登录控制台会自动发）
#   4. 校验身份，打印「你是谁」，并确认可以发布
#
# 幂等：随时可以重跑，不会覆盖已有令牌。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DV="$HERE/dvctl"

echo "== devbox-deploy 初始化 =="
VER="$(cat "$ROOT/VERSION" 2>/dev/null || echo dev)"
echo "版本: $VER"
echo "目录: $ROOT"

# 常见 AI 工具的 skills 目录（只是提示，放别处也能正常用）
CANON=""
for base in "$HOME/.workbuddy/skills" "$HOME/.claude/skills" "$HOME/.config/agent-skills"; do
  if [ -d "$base" ]; then CANON="$base/devbox-deploy"; break; fi
done
if [ -n "$CANON" ] && [ "$ROOT" != "$CANON" ]; then
  echo "提示: 惯例位置是 ${CANON}（现在在 ${ROOT}，功能不受影响，只是工具可能检索不到这个 skill）"
  echo "      mv \"$ROOT\" \"${CANON}\" 然后重跑 ${CANON}/scripts/setup.sh"
fi

[[ -f "$ROOT/SKILL.md" ]] || echo "! 这里不像 skill 根目录（缺 SKILL.md），确认解压位置是否对"
if [[ ! -f "$ROOT/ca.crt" ]]; then
  echo "! 缺少 ca.crt（内网自签证书）——没有它 dvctl 会因为证书校验失败而连不上" >&2
fi
command -v python3 >/dev/null 2>&1 || { echo "! 需要 python3，请先安装" >&2; exit 1; }

if [[ ! -f "$DV" ]]; then
  echo "! 缺少 scripts/dvctl，压缩包可能不完整" >&2
  exit 1
fi
[[ -x "$DV" ]] || chmod +x "$DV" 2>/dev/null || true

# 交给 dvctl setup 做剩下的事：建 .env、登录、校验
exec "$DV" setup
