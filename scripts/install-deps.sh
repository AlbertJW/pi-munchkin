#!/usr/bin/env bash
set -euo pipefail

# install-deps.sh — check/install every external (non-npm) prerequisite
# pi-munchkin's harness needs or uses:
#   - node, npm      required — hard failure if missing/too old.
#   - ketch          required (KETCH is on by default) — installed
#                     automatically: GitHub release binary + checksum verify,
#                     or brew on macOS if available.
#   - git, python3   optional — several extensions shell out to them and are
#                     explicitly designed to fail-open/skip silently without
#                     them; this only warns, since a missing one degrades a
#                     feature rather than breaking anything.
# npm package dependencies (typebox) are handled automatically by
# `pi package install` / `npm i` — not this script's job.
# Idempotent: safe to re-run, skips anything already satisfied. Installs to
# a user-local path, never requires sudo.
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

# ---------- npm ----------
# Bundled with virtually every Node.js install (nvm, official installer,
# system packages), but not guaranteed by a minimal/custom build — and
# `npm i typebox` is a required step for the manual (non-`pi package`)
# install path documented in README.md.
check_npm() {
	if ! command -v npm >/dev/null 2>&1; then
		die "npm not found alongside node. Required for 'pi package install' and the manual 'npm i typebox' install step (README.md). Reinstall Node.js with npm bundled, or install npm separately."
	fi
	log "npm $(npm --version) OK"
}

# ---------- optional: git ----------
# Several extensions shell out to git and are explicitly designed to
# fail-open (never block a run) when it's missing or the cwd isn't a repo —
# so a missing git is never a hard error, but it silently makes some
# features inert rather than erroring loudly, which is worth surfacing:
# git-guard's dirty-tree confirmation (extensions/git-guard.ts), context-brief's
# git-status section (extensions/context-brief.ts), drift-scanner's post-commit
# review (extensions/drift-scanner.ts), and plan-runner's c32 SHA-guard dark
# candidate (extensions/plan-runner.ts) all silently no-op without it.
check_git_optional() {
	if command -v git >/dev/null 2>&1; then
		log "git $(git --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) OK (optional; several extensions degrade gracefully without it)"
	else
		warn "git not found — optional, but git-guard's dirty-tree check, context-brief's git-status section, drift-scanner, and plan-runner's SHA-guard (c32) will all silently do nothing instead of erroring. Install git if you want those features active."
	fi
}

# ---------- optional: python3 ----------
# micro-gate's Python-specific post-edit parse/slop checks (extensions/micro-gate.ts,
# opt-in via MICRO_GATE=on) shell out to python3 and are explicitly designed
# to record a telemetry breadcrumb and skip silently — never block — if it's
# missing. JS/TS files are unaffected either way (checked via node, already
# required above).
check_python_optional() {
	if command -v python3 >/dev/null 2>&1; then
		log "python3 $(python3 --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) OK (optional; only used by micro-gate's Python-file checks)"
	else
		warn "python3 not found — optional, but micro-gate's Python-file parse/slop checks (when MICRO_GATE=on) will silently skip Python files instead of checking them. JS/TS checking is unaffected."
	fi
}

main() {
	check_node
	check_npm
	check_ketch
	check_git_optional
	check_python_optional
	log "all dependencies satisfied."
}

main "$@"
