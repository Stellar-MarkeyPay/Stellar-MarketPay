#!/usr/bin/env sh
set -eu

ROOT=$(git rev-parse --show-toplevel)

supports_hooks() {
  [ -n "${1:-}" ] && [ -x "$1" ] && "$1" -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1);
  ' >/dev/null 2>&1
}

NODE=${NODE_BINARY:-}
if ! supports_hooks "$NODE"; then
  NODE=$(command -v node 2>/dev/null || true)
fi

if ! supports_hooks "$NODE"; then
  for candidate in \
    "$HOME/.volta/bin/node" \
    "$HOME/.asdf/shims/node" \
    "$HOME"/.nvm/versions/node/*/bin/node
  do
    if supports_hooks "$candidate"; then
      NODE=$candidate
      break
    fi
  done
fi

if ! supports_hooks "$NODE"; then
  printf '%s\n' \
    'MarketPay hooks require Node.js >=22.12.' \
    'Install or activate it, then run: npm ci && npm run hooks:doctor' >&2
  exit 1
fi

exec "$NODE" "$ROOT/scripts/hooks/cli.mjs" "$@"
