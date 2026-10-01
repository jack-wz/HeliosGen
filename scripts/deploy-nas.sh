#!/usr/bin/env bash
#
# Deploy HeliosGen to the NAS — by building on THIS machine, not on the NAS.
#
# Why it works this way: on 2026-09-30 a `docker compose build` run on the NAS
# pushed it to load 158 with swap fully exhausted and kswapd0 at 30% CPU. The
# box already runs six-plus services and all processes together accounted for
# 15.1GB RSS against 15GB of RAM; a Next.js production build wants ~2GB and was
# the last straw. It took heliosgen unhealthy and Tailscale down with it.
# Building here costs one 447MB transfer (~10s on the LAN) and none of that risk.
#
# Usage:
#   scripts/deploy-nas.sh              # build, ship, deploy, verify
#   scripts/deploy-nas.sh --check      # only run the preconditions
#   scripts/deploy-nas.sh --skip-build # reuse the local image, just ship it
#
# Env overrides:
#   NAS_HOST    (default 192.168.1.185)   NAS_SSH_USER (default wyai)
#   NAS_SSH_KEY (default ~/.ssh/fnos_nas_key)
#   NAS_SSH     (default wyai@192.168.1.185 — set this to go over Tailscale)
#
set -euo pipefail

NAS_SSH_USER="${NAS_SSH_USER:-wyai}"
NAS_HOST="${NAS_HOST:-192.168.1.185}"
NAS_SSH_KEY="${NAS_SSH_KEY:-$HOME/.ssh/fnos_nas_key}"
NAS_SSH="${NAS_SSH:-${NAS_SSH_USER}@${NAS_HOST}}"
NAS_DIR="${NAS_DIR:-/home/wyai/heliosgen}"
IMAGE="${IMAGE:-heliosgen:nas-http-20260915}"
APP_VERSION="${APP_VERSION:-$(node -p "require('./package.json').version")}"

# Preconditions for building on the NAS instead of here. Not used by default —
# kept so the numbers are in one place if someone insists on building remotely.
MAX_LOAD=20
MIN_AVAIL_KB=$((3 * 1024 * 1024))

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=12)
[[ -f "$NAS_SSH_KEY" ]] && SSH_OPTS+=(-i "$NAS_SSH_KEY")
nas() { ssh "${SSH_OPTS[@]}" "$NAS_SSH" "$@"; }

CHECK_ONLY=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31m   FAIL: %s\033[0m\n' "$1" >&2; exit 1; }
ok()   { printf '   ok: %s\n' "$1"; }

step "1/6 本地 Docker"
docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 \
  || fail "本地 Docker daemon 未运行。启动 Docker Desktop 后重试。"
ok "daemon $(docker info --format '{{.ServerVersion}}')"

step "2/6 NAS 可达性与资源"
nas 'echo up' >/dev/null 2>&1 \
  || fail "无法 SSH 到 ${NAS_SSH}。局域网请确认 NAS_SSH_KEY（默认密钥只授权给 Tailscale SSH）；远程请设置 NAS_SSH。"

read -r LOAD AVAIL_KB UNHEALTHY <<<"$(nas '
  load=$(awk "{print \$1}" /proc/loadavg)
  avail=$(awk "/MemAvailable/{print \$2}" /proc/meminfo)
  unhealthy=$(docker ps --format "{{.Status}}" | grep -c unhealthy || true)
  echo "$load $avail $unhealthy"
')"
ok "load=${LOAD}  可用内存=$((AVAIL_KB / 1024))MB  unhealthy 容器=${UNHEALTHY}"

if awk "BEGIN{exit !($LOAD > $MAX_LOAD)}"; then
  printf '\033[33m   警告: load %s 高于 %s。NAS 已处于压力下，部署会加重它。\033[0m\n' "$LOAD" "$MAX_LOAD"
fi
(( AVAIL_KB >= MIN_AVAIL_KB )) || printf '\033[33m   警告: 可用内存仅 %sMB，低于 %sMB。\033[0m\n' "$((AVAIL_KB / 1024))" "$((MIN_AVAIL_KB / 1024))"
(( UNHEALTHY == 0 )) || printf '\033[33m   警告: 已有 %s 个 unhealthy 容器。\033[0m\n' "$UNHEALTHY"

if (( CHECK_ONLY )); then
  step "仅检查模式，到此结束"
  exit 0
fi

step "3/6 构建 linux/amd64 镜像"
if (( SKIP_BUILD )); then
  docker image inspect "$IMAGE" --format '{{.Architecture}}' | grep -q amd64 \
    || fail "本地 $IMAGE 不是 amd64；去掉 --skip-build。"
  ok "复用本地镜像"
else
  docker buildx build --platform linux/amd64 \
    -f Dockerfile.nas \
    --build-arg "APP_VERSION=$APP_VERSION" \
    -t "$IMAGE" --load . \
    || fail "构建失败"
fi
ARCH=$(docker image inspect "$IMAGE" --format '{{.Architecture}}')
[[ "$ARCH" == "amd64" ]] || fail "镜像架构是 ${ARCH}，NAS 需要 amd64"
ok "$IMAGE ($ARCH, 版本 $APP_VERSION)"

step "4/6 打包并传输"
TARBALL=$(mktemp -t heliosgen-amd64.XXXXXX.tar.gz)
trap 'rm -f "$TARBALL"' EXIT
docker save "$IMAGE" | gzip -1 > "$TARBALL"
ok "包大小 $(du -h "$TARBALL" | cut -f1)"

nas "cat > /tmp/heliosgen-amd64.tar.gz" < "$TARBALL"
ok "已传到 NAS"

step "5/6 同步源码 + 回滚点 + 加载 + 重建容器"
# The image is the deployable artifact, but the NAS tree is kept in step too —
# otherwise grepping the NAS shows stale code and the source backup below would
# capture a tree that does not match what is running.
tar czf - \
  --exclude='./node_modules' --exclude='./.next' --exclude='./.git' \
  --exclude='./data' --exclude='./public/generated' --exclude='./src-tauri' \
  --exclude='./cli/mcp/node_modules' --exclude='./output' \
  --exclude='./secrets' --exclude='./.env.sync' --exclude='./.seek-token.bak' \
  --exclude='./._*' --exclude='./.DS_Store' . 2>/dev/null \
  | nas "tar xzf - -C $NAS_DIR" \
  || fail "源码同步失败"
ok "源码已同步"
TAG="rollback-$(date +%Y%m%d-%H%M%S)"
nas "
  set -e
  cd $NAS_DIR
  docker tag $IMAGE heliosgen:$TAG
  tar czf /home/wyai/heliosgen-src-backup-$TAG.tar.gz \
    --exclude=node_modules --exclude=.next --exclude=secrets \
    --exclude=.seek-token.bak -C /home/wyai heliosgen
  docker load -i /tmp/heliosgen-amd64.tar.gz >/dev/null
  rm -f /tmp/heliosgen-amd64.tar.gz
  # --no-deps and naming the service: a bare "up -d" would recreate asset-bridge.
  docker compose --env-file .env.sync -f compose.nas.yaml up -d \
    --force-recreate --no-deps heliosgen
"
ok "回滚点 heliosgen:$TAG + 源码备份"

step "6/6 验证"
for i in $(seq 1 18); do
  [[ "$(nas 'docker inspect --format "{{.State.Health.Status}}" heliosgen')" == "healthy" ]] && break
  sleep 10
done
HEALTH=$(nas 'docker inspect --format "{{.State.Health.Status}}" heliosgen')
[[ "$HEALTH" == "healthy" ]] || fail "容器未恢复健康（当前 ${HEALTH}）。回滚: docker tag heliosgen:$TAG $IMAGE && docker compose ... up -d --force-recreate --no-deps heliosgen"
ok "容器 healthy"

nas '
  echo -n "   /api/workflows: "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -m 20 http://127.0.0.1:17860/api/workflows
  echo -n "   资产数: "; curl -s -m 25 http://127.0.0.1:17860/api/assets | python3 -c "import json,sys;print(len(json.load(sys.stdin).get(\"assets\",[])))" 2>/dev/null || echo "?"
  echo -n "   EACCES: "; docker logs heliosgen 2>&1 | grep -c EACCES
  echo -n "   桥接: "; docker ps --filter name=heliosgen-asset-bridge --format "{{.Status}}"
  echo -n "   负载: "; uptime | sed "s/.*load average: //"
'
printf '\n\033[32m部署完成。回滚点 heliosgen:%s\033[0m\n' "$TAG"
