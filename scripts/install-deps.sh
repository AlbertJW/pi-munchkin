#!/usr/bin/env bash
set -euo pipefail

# install-deps.sh — install/verify pi-munchkin's external (non-npm) runtime
# prerequisites: Node.js and the Ketch CLI. npm dependencies (typebox) are
# handled automatically by `pi package install` / `npm i` — not this script's
# job. Idempotent: safe to re-run, skips anything already satisfied. Installs
# to a user-local path, never requires sudo.
#
# Ketch ships prebuilt release binaries for linux/darwin/windows on
# amd64/arm64 (https://github.com/1broseidon/ketch/releases) — this downloads
# the right one, verifies its checksum, and installs it. On macOS with
# Homebrew available, brew is used instead (the natural default there).

MIN_KETCH_VERSION="0.12.0"
KETCH_REPO="1broseidon/ketch"
INSTALL_DIR="${KETCH_INSTALL_DIR:-$HOME/.local/bin}"

# A `trap ... RETURN` set inside a function is NOT function-scoped — it's a
# global handler that keeps firing on every later function return until
# explicitly cleared, referencing whatever local var it closed over even
# after that scope is gone (-> "unbound variable"). One top-level EXIT trap
# on a single shared path sidesteps that entirely.
TMP_DIR=""
# An EXIT trap's own exit status overrides the script's if the script never
# called `exit` explicitly (the normal case here) — `[ -n "$TMP_DIR" ]` alone
# returns 1 (nothing to clean up), which would silently turn a successful
# no-op run into a failed one. Always return 0.
cleanup() { [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"; return 0; }
trap cleanup EXIT

log() { echo "[install-deps] $*"; }
warn() { echo "[install-deps] WARNING: $*" >&2; }
die() { echo "[install-deps] ERROR: $*" >&2; exit 1; }

require_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "'$1' is required by this script but was not found on PATH."
}

# ---------- Node.js ----------
check_node() {
	require_cmd node
	# package.json's engines.node is the single source of truth for the
	# minimum version — read it instead of duplicating the number here.
	local pkg_json here min_ok
	here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
	pkg_json="$here/package.json"
	min_ok="$(node -e '
		const fs = require("node:fs");
		const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
		const need = (pkg.engines && pkg.engines.node || ">=0.0.0").replace(/^[^0-9]*/, "");
		const [nMaj, nMin, nPat] = need.split(".").map(Number);
		const [hMaj, hMin, hPat] = process.version.slice(1).split(".").map(Number);
		const have = [hMaj, hMin, hPat || 0], want = [nMaj, nMin || 0, nPat || 0];
		for (let i = 0; i < 3; i++) { if (have[i] > want[i]) { console.log("1"); process.exit(0); } if (have[i] < want[i]) { console.log("0"); process.exit(0); } }
		console.log("1");
	' "$pkg_json")"
	if [ "$min_ok" != "1" ]; then
		local need
		need="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).engines.node)' "$pkg_json")"
		die "node $(node --version) found, but pi-munchkin requires $need. Upgrade Node.js (nvm, your system package manager, or https://nodejs.org) and re-run."
	fi
	log "node $(node --version) OK"
}

# ---------- Ketch ----------
installed_ketch_version() {
	command -v ketch >/dev/null 2>&1 || return 1
	ketch version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1
}

# $1 >= $2, both "major.minor.patch"
version_ge() {
	[ "$1" = "$2" ] && return 0
	local higher
	higher="$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)"
	[ "$higher" = "$1" ]
}

install_ketch_brew() {
	log "installing ketch via Homebrew..."
	brew install 1broseidon/tap/ketch
}

install_ketch_release() {
	require_cmd curl
	require_cmd tar
	local os arch tag version asset url checksum_tool
	case "$(uname -s)" in
		Linux) os=linux ;;
		Darwin) os=darwin ;;
		*) die "no prebuilt ketch binary for OS '$(uname -s)'. Install manually: https://github.com/${KETCH_REPO}#installation" ;;
	esac
	case "$(uname -m)" in
		x86_64|amd64) arch=x86_64 ;;
		arm64|aarch64) arch=arm64 ;;
		*) die "no prebuilt ketch binary for architecture '$(uname -m)'. Install manually: https://github.com/${KETCH_REPO}#installation" ;;
	esac
	if command -v sha256sum >/dev/null 2>&1; then checksum_tool=sha256sum
	elif command -v shasum >/dev/null 2>&1; then checksum_tool="shasum -a 256"
	else die "need sha256sum or shasum to verify the download; install one and re-run."
	fi

	log "fetching latest ketch release metadata..."
	tag="$(curl -fsSL "https://api.github.com/repos/${KETCH_REPO}/releases/latest" | node -e '
		let d = ""; process.stdin.on("data", c => d += c);
		process.stdin.on("end", () => { console.log(JSON.parse(d).tag_name); });
	')"
	[ -n "$tag" ] || die "could not determine the latest ketch release tag from the GitHub API."
	version="${tag#v}"
	asset="ketch_${version}_${os}_${arch}.tar.gz"
	url="https://github.com/${KETCH_REPO}/releases/download/${tag}/${asset}"

	TMP_DIR="$(mktemp -d)"
	log "downloading $asset ($tag)..."
	curl -fsSL -o "$TMP_DIR/$asset" "$url" || die "download failed: $url"
	curl -fsSL -o "$TMP_DIR/checksums.txt" "https://github.com/${KETCH_REPO}/releases/download/${tag}/checksums.txt" \
		|| die "could not fetch checksums.txt — refusing to install an unverified binary."

	log "verifying checksum..."
	grep " ${asset}\$" "$TMP_DIR/checksums.txt" > "$TMP_DIR/${asset}.sha256" \
		|| die "no checksum entry found for $asset in checksums.txt"
	( cd "$TMP_DIR" && $checksum_tool -c "${asset}.sha256" >/dev/null ) \
		|| die "checksum verification FAILED for $asset — aborting install, download may be corrupted or tampered."

	log "extracting to $INSTALL_DIR..."
	mkdir -p "$INSTALL_DIR"
	tar -xzf "$TMP_DIR/$asset" -C "$TMP_DIR" ketch
	install -m 0755 "$TMP_DIR/ketch" "$INSTALL_DIR/ketch"
	log "ketch $version installed to $INSTALL_DIR/ketch"

	case ":$PATH:" in
		*":$INSTALL_DIR:"*) ;;
		*) warn "$INSTALL_DIR is not on PATH. Add it, e.g.: echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.bashrc (or ~/.zshrc)" ;;
	esac
}

check_ketch() {
	local have
	have="$(installed_ketch_version || true)"
	if [ -n "$have" ] && version_ge "$have" "$MIN_KETCH_VERSION"; then
		log "ketch $have OK (>= $MIN_KETCH_VERSION required)"
		return
	fi
	if [ -n "$have" ]; then
		log "ketch $have found, but pi-munchkin requires >= $MIN_KETCH_VERSION — upgrading"
	else
		log "ketch not found — installing"
	fi
	if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
		install_ketch_brew
	else
		install_ketch_release
	fi
	have="$(installed_ketch_version || true)"
	if [ -z "$have" ] || ! version_ge "$have" "$MIN_KETCH_VERSION"; then
		die "ketch install completed but a healthy version still isn't on PATH — run 'ketch version' manually to investigate (check the PATH warning above)."
	fi
	log "ketch $have ready"
}

main() {
	check_node
	check_ketch
	log "all dependencies satisfied."
}

main "$@"
