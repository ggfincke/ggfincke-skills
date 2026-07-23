# ggfincke-skills - automation entrypoints.
# run `make` (or `make help`) to list targets

PYTHON    ?= python3
SCRIPTS   := scripts
HOOKS_DIR := scripts/hooks
BROKER     := tools/worker-broker

.DEFAULT_GOAL := help
.PHONY: help validate test broker-check check sync sync-force sync-copy sync-copy-force sync-agents sync-agents-force sync-project sync-project-repo install-hooks uninstall-hooks clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-17s\033[0m %s\n", $$1, $$2}'

validate: ## Validate all canonical skills (strict frontmatter)
	$(PYTHON) $(SCRIPTS)/validate-skills.py

test: ## Run the sync/parser/checker regression tests
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py'

broker-check: ## Typecheck, build, & test the worker broker
	npm --prefix $(BROKER) run check

check: validate test broker-check ## Run validation + tests (the full gate)

sync: check ## Symlink all skills into canonical Codex/agents + Claude roots
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target all --mode link

sync-force: check ## Symlink all skills, replacing existing installs
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target all --mode link --force

sync-copy: check ## Copy all skills as stable snapshots
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target all --mode copy

sync-copy-force: check ## Copy all skills as stable snapshots, replacing existing installs
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target all --mode copy --force

sync-agents: check ## Symlink Claude custom agents into the personal agent root
	$(PYTHON) $(SCRIPTS)/sync-agents.py --mode link

sync-agents-force: check ## Replace Claude custom agents with canonical symlinks
	$(PYTHON) $(SCRIPTS)/sync-agents.py --mode link --force

sync-project: check ## Install portable skills into a project's .claude/skills (PROJECT=/path)
	@test -n "$(PROJECT)" || { echo "set PROJECT=/path/to/repo"; exit 1; }
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target project-claude --project "$(PROJECT)" --mode link

sync-project-repo: check ## Install projects/REPO skills into that repo's .agents (REPO=name PROJECT=/path)
	@test -n "$(REPO)" || { echo "set REPO=<projects subdir>"; exit 1; }
	@test -n "$(PROJECT)" || { echo "set PROJECT=/path/to/repo"; exit 1; }
	$(PYTHON) $(SCRIPTS)/sync-skills.py --project-repo "$(REPO)" --project "$(PROJECT)" --mode link

install-hooks: ## Route git hooks at scripts/hooks (validate runs pre-commit)
	git config core.hooksPath $(HOOKS_DIR)
	@echo "git hooks -> $(HOOKS_DIR)"

uninstall-hooks: ## Restore git's default hooks path
	git config --unset core.hooksPath || true

clean: ## Remove caches and OS cruft
	@find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@find . -name '*.pyc' -delete 2>/dev/null || true
	@find . -name '.DS_Store' -delete 2>/dev/null || true
