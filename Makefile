# ggfincke-skills - automation entrypoints.
# run `make` (or `make help`) to list targets

PYTHON    ?= python3
SCRIPTS   := scripts
HOOKS_DIR := scripts/hooks
BROKER     := tools/worker-broker

.DEFAULT_GOAL := help
.PHONY: generate generated-check doctor help validate test broker-check audit audit-root audit-broker format format-check format-python format-python-check check sync sync-force sync-copy sync-copy-force sync-agy sync-agy-force sync-agents sync-agents-force sync-mcp sync-mcp-dry-run sync-project sync-project-repo install-hooks uninstall-hooks clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

validate: ## Validate all canonical skills (strict frontmatter)
	$(PYTHON) $(SCRIPTS)/validate-skills.py

generate: ## Refresh packaged references and repository-owned instruction outputs
	$(PYTHON) $(SCRIPTS)/compile-skill-references.py
	$(PYTHON) $(SCRIPTS)/generate-instructions.py
	$(PYTHON) skills/working-conventions/scripts/export-cursor-guard.py

generated-check: ## Verify generated references and instruction outputs without writing
	$(PYTHON) $(SCRIPTS)/compile-skill-references.py --check
	$(PYTHON) $(SCRIPTS)/generate-instructions.py --check
	$(PYTHON) skills/working-conventions/scripts/export-cursor-guard.py --check

doctor: ## Inspect existing local skill hosts and broker configuration without repair
	$(PYTHON) $(SCRIPTS)/doctor.py --target agents --target claude

test: ## Run the sync/parser/checker regression tests
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py'

broker-check: ## Typecheck, build, & test the worker broker
	npm --prefix $(BROKER) run check

audit-root: ## Audit root dependencies at the shared CI severity threshold
	npm audit --audit-level=high

audit-broker: ## Audit broker dependencies at the shared CI severity threshold
	npm --prefix $(BROKER) audit --audit-level=high

audit: audit-root audit-broker ## Audit both npm dependency trees

format: ## Mutating Prettier + ESLint fix on owned TS/JS
	npm run format

format-check: ## Non-mutating Prettier + ESLint (comment-style) check
	npm run format:check

format-python: ## Mutating Ruff + Python comment-style fix
	npm run format:python

format-python-check: ## Non-mutating Ruff + Python comment-style check
	npm run format:python:check

check: validate generated-check test broker-check format-check format-python-check audit ## Full gate: validate, generated outputs, tests, broker, format, audits

sync: check ## Symlink all skills into canonical Codex/agents + Claude roots
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target agents --target claude --mode link

sync-force: check ## Symlink all skills, replacing existing installs
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target agents --target claude --mode link --force

sync-copy: check ## Copy all skills as stable snapshots
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target agents --target claude --mode copy

sync-copy-force: check ## Copy all skills as stable snapshots, replacing existing installs
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target agents --target claude --mode copy --force

sync-agy: check ## Symlink all skills into Antigravity CLI (agy)
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target agy --mode link

sync-agy-force: check ## Symlink all skills into agy, replacing existing installs
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target agy --mode link --force

sync-agents: check ## Symlink Claude custom agents into the personal agent root
	$(PYTHON) $(SCRIPTS)/sync-agents.py --mode link

sync-agents-force: check ## Replace Claude custom agents with canonical symlinks
	$(PYTHON) $(SCRIPTS)/sync-agents.py --mode link --force

sync-mcp: check ## Merge the canonical MCP registry into opencode + Claude Code configs
	$(PYTHON) $(SCRIPTS)/sync-mcp.py

sync-mcp-dry-run: check ## Preview MCP registry merges without writing anything
	$(PYTHON) $(SCRIPTS)/sync-mcp.py --dry-run

sync-project: check ## Install portable skills into a project's .claude/skills (PROJECT=/path)
	@test -n "$(PROJECT)" || { echo "set PROJECT=/path/to/repo"; exit 1; }
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target project-claude --project "$(PROJECT)" --mode link

sync-project-repo: check ## Install projects/REPO skills into that repo's .agents (REPO=name PROJECT=/path)
	@test -n "$(REPO)" || { echo "set REPO=<projects subdir>"; exit 1; }
	@test -n "$(PROJECT)" || { echo "set PROJECT=/path/to/repo"; exit 1; }
	$(PYTHON) $(SCRIPTS)/sync-skills.py --project-repo "$(REPO)" --project "$(PROJECT)" --mode link

install-hooks: ## Route hooks: owned staged formatting, then final-index validation + tests
	git config core.hooksPath $(HOOKS_DIR)
	@echo "git hooks -> $(HOOKS_DIR)"

uninstall-hooks: ## Restore git's default hooks path
	git config --unset core.hooksPath || true

clean: ## Remove caches and OS cruft
	@find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@find . -name '*.pyc' -delete 2>/dev/null || true
	@find . -name '.DS_Store' -delete 2>/dev/null || true
