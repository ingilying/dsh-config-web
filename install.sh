#!/usr/bin/env bash
# One-command installer shim for dsh-config-web.
#
# From a checkout:
#   ./install.sh
#   ./install.sh --profile web
#
# Piped from the web (works before the first npm publish, because the package
# is fetched from its repository):
#   curl -fsSL https://raw.githubusercontent.com/ingilying/dsh-config-web/main/install.sh | bash
#
# Everything after the script name is forwarded to the installer verbatim;
# `node bin/install.mjs --help` documents the flags.
set -euo pipefail

# Where the piped form fetches the package from. Point it at a published
# version (`dsh-config-web@1.2.3`) or a branch (`github:ingilying/dsh-config-web#main`)
# to install something other than the default branch.
from="${DSH_CONFIG_WEB_FROM:-github:ingilying/dsh-config-web}"

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || die "node was not found on PATH; install Node.js 20 or newer"

# Node 20 is the oldest release with a stable ESM loader and `process.exitCode` await support.
node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 ? 0 : 1)' \
  || die "Node.js 20 or newer is required (found $(node -v))"

# Resolve the directory holding this script. When the script arrives on stdin
# (`curl ... | bash`) there is no such directory, so fall back to npx, which
# fetches the package and runs the same installer from its `bin`.
source_path="${BASH_SOURCE[0]:-}"
if [ -n "$source_path" ] && [ -f "$source_path" ]; then
  script_dir="$(cd -- "$(dirname -- "$source_path")" && pwd)"
  exec node "$script_dir/bin/install.mjs" "$@"
fi

command -v npx >/dev/null 2>&1 || die "this script was piped into bash, so it needs npx to fetch dsh-config-web; install npm, or clone the repository and run ./install.sh"

# An explicit --source wins; otherwise the profile records the same spec the
# installer itself is running from, so it stays in step with this script.
has_source=false
for argument in "$@"; do
  case "$argument" in
    --source | --source=* | --from | --from=*) has_source=true ;;
  esac
done
if [ "$has_source" = false ]; then
  set -- --source "$from" "$@"
fi

printf 'dsh-config-web: fetching %s with npx\n' "$from" >&2
exec npx --yes "$from" install "$@"
