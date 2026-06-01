SHELL := /bin/sh

BIOME := bunx @biomejs/biome check --linter-enabled=false
STYLELINT := bunx stylelint --allow-empty-input
VALE := vale
LSLINT := bunx ls-lint
OXLINT := bunx oxlint
TYPECHECK := bunx tsc --noEmit
KNIP := bunx knip
VITEST := bunx vitest --run
CONTRAST := bun run contrast
GITLEAKS := gitleaks detect --source .
CONTRACT_TESTS := test/schema-consistency.test.ts test/codec.test.ts test/addr.test.ts test/runtime-config.test.ts test/replay.test.ts test/data-lineage.test.ts test/gateway-verification.test.ts test/agency-export.test.ts test/scenarios.test.ts
DOC_PATHS := README.md SPEC.md PERSONA.md LIMITATIONS.md AGENTS.md CLAUDE.md $(wildcard docs data news)
TEST ?=
RUNTIME_PRIVATE_DIR ?= $(HOME)/.config/dovetail
RUNTIME_IDENTITY_FILE ?= $(RUNTIME_PRIVATE_DIR)/age.key
RUNTIME_SOURCE_FILE ?= $(RUNTIME_PRIVATE_DIR)/runtime.json.age
RUNTIME_WORK_ROOT ?= $(shell if [ -d /dev/shm ]; then printf /dev/shm; else printf %s "$${TMPDIR:-/tmp}"; fi)
RUNTIME_WORK_DIR ?= $(RUNTIME_WORK_ROOT)/dovetail
RUNTIME_WORK_FILE ?= $(RUNTIME_WORK_DIR)/runtime.json
FILES ?= .

.PHONY: fmt lint lint-full lint-format lint-js lint-contrast lint-styles lint-names lint-docs lint-secrets dev test test-file typecheck pre-push verify verify-docs verify-contract runtime-init runtime-prepare data-hazard data-pmtiles data-all knip

fmt:
	$(BIOME) --write $(FILES)

lint: lint-format lint-js lint-contrast

lint-full: lint-format lint-js lint-styles lint-names lint-docs

lint-format:
	$(BIOME) $(FILES)

lint-js:
	$(OXLINT) $(FILES)

lint-contrast:
	$(CONTRAST)

lint-styles:
	if [ "$(FILES)" = "." ] || [ -z "$(FILES)" ]; then $(STYLELINT) "**/*.{css,scss}"; else $(STYLELINT) $(FILES); fi

lint-names:
	$(LSLINT) $(FILES)

lint-docs:
	if [ "$(FILES)" = "." ] || [ -z "$(FILES)" ]; then $(VALE) $(DOC_PATHS); else $(VALE) $(FILES); fi

lint-secrets:
	$(GITLEAKS)

dev:
	bun run --hot src/server.ts

runtime-init:
	mkdir -p "$(RUNTIME_PRIVATE_DIR)"
	if [ -f "$(RUNTIME_SOURCE_FILE)" ] && [ ! -f "$(RUNTIME_IDENTITY_FILE)" ]; then echo "missing rage identity file: $(RUNTIME_IDENTITY_FILE)" >&2; exit 1; fi
	if [ ! -f "$(RUNTIME_IDENTITY_FILE)" ]; then rage-keygen -o "$(RUNTIME_IDENTITY_FILE)" >/dev/null; fi
	chmod 600 "$(RUNTIME_IDENTITY_FILE)"
	if [ ! -f "$(RUNTIME_SOURCE_FILE)" ]; then tmpfile="$$(mktemp "$(RUNTIME_PRIVATE_DIR)/runtime.XXXXXX")"; encrypted_tmpfile="$$(mktemp "$(RUNTIME_PRIVATE_DIR)/runtime.age.XXXXXX")"; trap 'rm -f "$$tmpfile" "$$encrypted_tmpfile"' EXIT HUP INT TERM; umask 077; printf '{\n  "demoKeyHex": "%s",\n  "tgos": {},\n  "tokens": {}\n}\n' "$$(openssl rand -hex 16)" > "$$tmpfile"; rage -r "$$(rage-keygen -y "$(RUNTIME_IDENTITY_FILE)")" -o "$$encrypted_tmpfile" "$$tmpfile" && mv "$$encrypted_tmpfile" "$(RUNTIME_SOURCE_FILE)"; rm -f "$$tmpfile" "$$encrypted_tmpfile"; trap - EXIT HUP INT TERM; fi
	if [ -f "$(RUNTIME_SOURCE_FILE)" ]; then chmod 600 "$(RUNTIME_SOURCE_FILE)"; fi

runtime-prepare:
	if [ ! -f "$(RUNTIME_SOURCE_FILE)" ]; then echo "[runtime-prepare] missing encrypted runtime source: $(RUNTIME_SOURCE_FILE)" >&2; echo "[runtime-prepare] run \`make runtime-init\` once to bootstrap the rage identity and encrypted runtime." >&2; exit 1; fi
	if [ ! -f "$(RUNTIME_IDENTITY_FILE)" ]; then echo "[runtime-prepare] missing rage identity file: $(RUNTIME_IDENTITY_FILE)" >&2; echo "[runtime-prepare] run \`make runtime-init\` once to provision it (do not regenerate if a teammate already shared the identity)." >&2; exit 1; fi
	mkdir -p "$(RUNTIME_WORK_DIR)" && rm -f "$(RUNTIME_WORK_FILE)" && tmpfile="$$(mktemp "$(RUNTIME_WORK_DIR)/runtime.XXXXXX")"; trap 'rm -f "$$tmpfile"' EXIT HUP INT TERM; rage --decrypt -i "$(RUNTIME_IDENTITY_FILE)" -o "$$tmpfile" "$(RUNTIME_SOURCE_FILE)" && chmod 600 "$$tmpfile" && mv "$$tmpfile" "$(RUNTIME_WORK_FILE)"; rm -f "$$tmpfile"; trap - EXIT HUP INT TERM

test:
	$(VITEST)

test-file:
	if [ -z "$(TEST)" ]; then echo "TEST=<path-to-vitest-file> is required" >&2; exit 1; fi
	$(VITEST) $(TEST)

typecheck:
	$(TYPECHECK)

pre-push: typecheck knip test

verify: lint pre-push

verify-docs: lint-docs
	$(VITEST) test/agent-workflow.test.ts

verify-contract: typecheck
	$(VITEST) $(CONTRACT_TESTS)

data-hazard:
	bash scripts/build-hazard-layer.sh

data-pmtiles:
	bash scripts/build-pmtiles.sh

data-all: data-hazard data-pmtiles

knip:
	$(KNIP)

diff:
	git diff --exit-code > temp.diff || true
# bunx commitlint --edit commit-msg.txt

