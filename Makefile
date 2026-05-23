# ggfincke-skills — automation entrypoints.
# Run `make` (or `make help`) to list targets.

PYTHON    ?= python3
SCRIPTS   := scripts
HOOKS_DIR := scripts/hooks

.DEFAULT_GOAL := help
.PHONY: help validate sync sync-copy sync-project install-hooks uninstall-hooks clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

validate: ## Validate all canonical skills
	$(PYTHON) $(SCRIPTS)/validate-skills.py

sync: validate ## Symlink all skills into Codex/agents/Claude (active dev)
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target all --mode link

sync-copy: validate ## Copy all skills as stable snapshots
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target all --mode copy

sync-project: validate ## Install into a project's .claude/skills (PROJECT=/path)
	@test -n "$(PROJECT)" || { echo "set PROJECT=/path/to/repo"; exit 1; }
	$(PYTHON) $(SCRIPTS)/sync-skills.py --target project-claude --project "$(PROJECT)" --mode link

install-hooks: ## Route git hooks at scripts/hooks (validate runs pre-commit)
	git config core.hooksPath $(HOOKS_DIR)
	@echo "git hooks -> $(HOOKS_DIR)"

uninstall-hooks: ## Restore git's default hooks path
	git config --unset core.hooksPath || true

clean: ## Remove caches and OS cruft
	@find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@find . -name '*.pyc' -delete 2>/dev/null || true
	@find . -name '.DS_Store' -delete 2>/dev/null || true
