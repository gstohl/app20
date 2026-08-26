#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="${ROOT_DIR}/vendor"
PRIVACY_DIR="${VENDOR_DIR}/starknet-privacy"
SDK_DIR="${PRIVACY_DIR}/sdk"
CLIENT_DIR="${PRIVACY_DIR}/client"
BIN_DIR="${VENDOR_DIR}/bin"
TOOLCHAINS_DIR="${VENDOR_DIR}/toolchains"
HARNESS_DIR="${ROOT_DIR}/pool-harness"

PRIVACY_REPOSITORY="https://github.com/starkware-libs/starknet-privacy.git"
PRIVACY_REF="PRIVACY-0.14.3-RC.5"
PRIVACY_COMMIT="66e3caae8c0201227a6719696d004e30d90aea65"
SCARB_VERSION="2.17.0"
USC_VERSION="2.8.0"
DEVNET_VERSION="0.8.0-rc.3"

MODE="${1:-setup}"
CURRENT_STEP="initialization"
TMP_DIR=""

cleanup() {
	if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
		rm -rf "${TMP_DIR}"
	fi
}

on_error() {
	local status=$?
	trap - ERR
	printf 'APP20 real-pool setup failed during "%s" (exit %s).\n' \
		"${CURRENT_STEP}" "${status}" >&2
	exit "${status}"
}

trap cleanup EXIT
trap on_error ERR

step() {
	CURRENT_STEP="$1"
	shift
	printf '\n==> %s\n' "${CURRENT_STEP}"
	"$@"
}

fail() {
	printf 'APP20 real-pool setup error: %s\n' "$1" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "required command '$1' was not found."
}

check_node() {
	local major
	major="$(node -p 'Number(process.versions.node.split(".")[0])')"
	if [[ ! "${major}" =~ ^[0-9]+$ ]] || (( major < 24 )); then
		fail "Node >=24 is required; found $(node --version)."
	fi
	printf 'Node: %s\n' "$(node --version)"
}

platform_target() {
	local system machine
	system="$(uname -s)"
	machine="$(uname -m)"
	case "${system}-${machine}" in
		Darwin-arm64 | Darwin-aarch64)
			printf 'aarch64-apple-darwin\n'
			;;
		Darwin-x86_64)
			printf 'x86_64-apple-darwin\n'
			;;
		Linux-arm64 | Linux-aarch64)
			printf 'aarch64-unknown-linux-gnu\n'
			;;
		Linux-x86_64)
			printf 'x86_64-unknown-linux-gnu\n'
			;;
		*)
			fail "unsupported platform ${system}/${machine}; install the pinned tools manually in vendor/bin."
			;;
	esac
}

check_vendor_clone() {
	if [[ ! -d "${PRIVACY_DIR}/.git" ]]; then
		fail "missing pinned clone at ${PRIVACY_DIR}; run 'npm run pool:setup'."
	fi

	local actual_commit source_status
	actual_commit="$(git -C "${PRIVACY_DIR}" rev-parse HEAD)"
	if [[ "${actual_commit}" != "${PRIVACY_COMMIT}" ]]; then
		fail "vendor clone is at ${actual_commit}, expected ${PRIVACY_COMMIT} (${PRIVACY_REF}); move vendor/starknet-privacy aside and retry."
	fi
	source_status="$(git -C "${PRIVACY_DIR}" status --porcelain --untracked-files=no)"
	if [[ -n "${source_status}" ]]; then
		fail "vendor/starknet-privacy has tracked changes; restore the pinned clone and retry."
	fi
	printf 'Privacy source: %s (%s)\n' "${PRIVACY_REF}" "${actual_commit}"
}

ensure_vendor_clone() {
	mkdir -p "${VENDOR_DIR}"
	if [[ ! -e "${PRIVACY_DIR}" ]]; then
		git clone --depth 1 --branch "${PRIVACY_REF}" --single-branch \
			"${PRIVACY_REPOSITORY}" "${PRIVACY_DIR}"
	elif [[ ! -d "${PRIVACY_DIR}/.git" ]]; then
		fail "${PRIVACY_DIR} exists but is not a git clone; move it aside and retry."
	fi
	check_vendor_clone
}

install_bundle() {
	local name="$1"
	local url="$2"
	local archive_root_name="$3"
	local destination="$4"
	local executable_name="$5"
	local archive="${TMP_DIR}/${name}.tar.gz"
	local extract_dir="${TMP_DIR}/${name}"

	curl --fail --location --retry 3 --show-error "${url}" --output "${archive}"
	mkdir -p "${extract_dir}"
	tar -xzf "${archive}" -C "${extract_dir}"
	if [[ ! -x "${extract_dir}/${archive_root_name}/bin/${executable_name}" ]]; then
		fail "${name} archive did not contain bin/${executable_name}."
	fi
	rm -rf "${destination}"
	mkdir -p "$(dirname "${destination}")"
	mv "${extract_dir}/${archive_root_name}" "${destination}"
}

ensure_scarb() {
	local target="$1"
	local destination="${TOOLCHAINS_DIR}/scarb-${SCARB_VERSION}"
	local executable="${destination}/bin/scarb"
	if [[ ! -x "${executable}" ]] || ! "${executable}" --version 2>/dev/null | grep -q "^scarb ${SCARB_VERSION} "; then
		install_bundle \
			"Scarb ${SCARB_VERSION}" \
			"https://github.com/software-mansion/scarb/releases/download/v${SCARB_VERSION}/scarb-v${SCARB_VERSION}-${target}.tar.gz" \
			"scarb-v${SCARB_VERSION}-${target}" \
			"${destination}" \
			"scarb"
	fi
	mkdir -p "${BIN_DIR}"
	ln -sfn "../toolchains/scarb-${SCARB_VERSION}/bin/scarb" "${BIN_DIR}/scarb"
	"${BIN_DIR}/scarb" --version | head -n 1
}

ensure_usc() {
	local target="$1"
	local destination="${TOOLCHAINS_DIR}/universal-sierra-compiler-${USC_VERSION}"
	local executable="${destination}/bin/universal-sierra-compiler"
	if [[ ! -x "${executable}" ]] || ! "${executable}" --version 2>/dev/null | grep -q "${USC_VERSION}"; then
		install_bundle \
			"Universal Sierra Compiler ${USC_VERSION}" \
			"https://github.com/software-mansion/universal-sierra-compiler/releases/download/v${USC_VERSION}/universal-sierra-compiler-v${USC_VERSION}-${target}.tar.gz" \
			"universal-sierra-compiler-v${USC_VERSION}-${target}" \
			"${destination}" \
			"universal-sierra-compiler"
	fi
	mkdir -p "${BIN_DIR}"
	ln -sfn "../toolchains/universal-sierra-compiler-${USC_VERSION}/bin/universal-sierra-compiler" \
		"${BIN_DIR}/universal-sierra-compiler"
	"${BIN_DIR}/universal-sierra-compiler" --version
}

ensure_devnet() {
	local target="$1"
	local executable="${BIN_DIR}/starknet-devnet"
	if [[ ! -x "${executable}" ]] || ! "${executable}" --version 2>/dev/null | grep -q "starknet-devnet ${DEVNET_VERSION}"; then
		local archive="${TMP_DIR}/starknet-devnet.tar.gz"
		local extract_dir="${TMP_DIR}/starknet-devnet"
		curl --fail --location --retry 3 --show-error \
			"https://github.com/starknet-io/starknet-devnet/releases/download/v${DEVNET_VERSION}/starknet-devnet-${target}.tar.gz" \
			--output "${archive}"
		mkdir -p "${extract_dir}" "${BIN_DIR}"
		tar -xzf "${archive}" -C "${extract_dir}"
		if [[ ! -f "${extract_dir}/starknet-devnet" ]]; then
			fail "starknet-devnet archive did not contain the expected binary."
		fi
		install -m 0755 "${extract_dir}/starknet-devnet" "${executable}"
	fi
	"${executable}" --version
}

install_sdk_dependencies() {
	(cd "${SDK_DIR}" && npm ci)
}

install_client_dependencies() {
	(cd "${CLIENT_DIR}" && npm ci)
}

build_privacy_contracts() {
	(cd "${SDK_DIR}" && PATH="${BIN_DIR}:${PATH}" npm run scarb:build)
}

build_sdk() {
	(cd "${SDK_DIR}" && npm run build)
}

build_client() {
	(cd "${CLIENT_DIR}" && npm run build)
}

install_harness_dependencies() {
	(cd "${HARNESS_DIR}" && npm ci)
}

assert_file() {
	[[ -f "$1" ]] || fail "missing $1; run 'npm run pool:setup'."
}

assert_executable() {
	[[ -x "$1" ]] || fail "missing executable $1; run 'npm run pool:setup'."
}

check_installation() {
	check_vendor_clone
	assert_executable "${BIN_DIR}/scarb"
	assert_executable "${BIN_DIR}/universal-sierra-compiler"
	assert_executable "${BIN_DIR}/starknet-devnet"

	"${BIN_DIR}/scarb" --version 2>/dev/null | grep -q "^scarb ${SCARB_VERSION} " || \
		fail "vendor/bin/scarb is not Scarb ${SCARB_VERSION}; run 'npm run pool:setup'."
	"${BIN_DIR}/universal-sierra-compiler" --version 2>/dev/null | grep -q "${USC_VERSION}" || \
		fail "vendor/bin/universal-sierra-compiler is not ${USC_VERSION}; run 'npm run pool:setup'."
	"${BIN_DIR}/starknet-devnet" --version 2>/dev/null | grep -q "starknet-devnet ${DEVNET_VERSION}" || \
		fail "vendor/bin/starknet-devnet is not ${DEVNET_VERSION}; run 'npm run pool:setup'."

	assert_file "${PRIVACY_DIR}/target/dev/privacy_Privacy.contract_class.json"
	assert_file "${PRIVACY_DIR}/target/dev/privacy_Privacy.compiled_contract_class.json"
	assert_file "${SDK_DIR}/dist/testing/index.js"
	assert_file "${CLIENT_DIR}/dist/index.js"
	assert_file "${HARNESS_DIR}/package-lock.json"
	assert_file "${HARNESS_DIR}/node_modules/@starkware-libs/starknet-privacy-sdk/dist/testing/index.js"
	assert_file "${HARNESS_DIR}/node_modules/@starkware-libs/starknet-privacy-client/dist/index.js"
	(cd "${HARNESS_DIR}" && node --input-type=module --eval \
		'await import("@starkware-libs/starknet-privacy-sdk/testing"); await import("@starkware-libs/starknet-privacy-client")')

	printf 'Scarb: %s (repository-local; cairo/ remains unchanged)\n' \
		"$("${BIN_DIR}/scarb" --version | head -n 1)"
	printf 'Universal Sierra Compiler: %s\n' \
		"$("${BIN_DIR}/universal-sierra-compiler" --version)"
	printf 'Starknet Devnet: %s\n' \
		"$("${BIN_DIR}/starknet-devnet" --version)"
	printf 'Real-pool harness prerequisites are ready.\n'
}

case "${MODE}" in
	setup | --check)
		;;
	-h | --help)
		printf 'Usage: %s [--check]\n' "$0"
		printf 'Without --check, install and build the ignored real-pool toolchain.\n'
		exit 0
		;;
	*)
		fail "unknown argument '${MODE}'; expected --check."
		;;
esac

step "checking required host tools" require_command git
step "checking curl" require_command curl
step "checking tar" require_command tar
step "checking npm" require_command npm
step "checking Node >=24" check_node

if [[ "${MODE}" == "--check" ]]; then
	step "checking the pinned real-pool installation" check_installation
	exit 0
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/app20-pool-setup.XXXXXX")"
TARGET="$(platform_target)"

step "cloning pinned starknet-privacy source" ensure_vendor_clone
step "installing repository-local Scarb ${SCARB_VERSION}" ensure_scarb "${TARGET}"
step "installing repository-local Universal Sierra Compiler ${USC_VERSION}" ensure_usc "${TARGET}"
step "installing native starknet-devnet ${DEVNET_VERSION}" ensure_devnet "${TARGET}"
step "installing vendored SDK dependencies" install_sdk_dependencies
step "installing vendored client dependencies" install_client_dependencies
step "building the real privacy_Privacy Cairo artifacts with Scarb ${SCARB_VERSION}" build_privacy_contracts
step "building the vendored TypeScript SDK" build_sdk
step "building the vendored TypeScript client" build_client
step "installing isolated pool-harness dependencies" install_harness_dependencies
step "verifying the complete real-pool installation" check_installation
