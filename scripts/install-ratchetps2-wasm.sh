#!/usr/bin/env bash
set -euo pipefail

repo="${WASM_REPO:-badger41/ratchet-ps2-cli}"
version="${WASM_VERSION:-}"
package_dir="${WASM_PACKAGE_DIR:-}"

if [[ -z "$version" ]]; then
  version="$(tr -d '[:space:]' < ratchetps2-wasm.version)"
fi

if [[ -z "$version" ]]; then
  echo "No WASM version provided. Set WASM_VERSION or ratchetps2-wasm.version." >&2
  exit 1
fi

if [[ -z "$package_dir" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI is required to download the Ratchet PS2 WASM release. Set WASM_PACKAGE_DIR to install from a local package directory." >&2
    exit 1
  fi

  artifact_name="ratchetps2-wasm-${version}.tar.gz"
  download_dir=".wasm-release"
  extract_dir="${download_dir}/extract"

  rm -rf "$download_dir"
  mkdir -p "$download_dir" "$extract_dir"

  echo "Downloading ${artifact_name} from ${repo}..."
  gh release download "$version" \
    --repo "$repo" \
    --pattern "$artifact_name" \
    --dir "$download_dir"

  tar -xzf "${download_dir}/${artifact_name}" -C "$extract_dir"
  package_dir="${extract_dir}/package"
fi

test -f "${package_dir}/ratchetps2-wasm.js"
test -f "${package_dir}/ratchetps2-wasm.d.ts"
test -d "${package_dir}/_framework"

rm -rf public/ratchetps2 src/vendor/ratchetps2-wasm
mkdir -p public/ratchetps2 src/vendor/ratchetps2-wasm

cp -R "${package_dir}/_framework" public/ratchetps2/
cp "${package_dir}/ratchetps2-wasm.js" public/ratchetps2/
cp "${package_dir}/ratchetps2-wasm.js" src/vendor/ratchetps2-wasm/
cp "${package_dir}/ratchetps2-wasm.d.ts" src/vendor/ratchetps2-wasm/

if [[ -f "${package_dir}/ratchetps2-wasm-release.json" ]]; then
  cp "${package_dir}/ratchetps2-wasm-release.json" public/ratchetps2/
fi

echo "Installed Ratchet PS2 WASM ${version}."
