#!/usr/bin/env bash
# skills/branch-sweep/scripts/sweep-plan.sh
# read-only sweep plan from live remote heads, complete merged-PR discovery & local refs

set -euo pipefail

# protected branch names that are never swept
PROTECTED_RE='^(main|master|develop|development|prod|production|staging|release(/.*)?|hotfix(/.*)?)$'

explicit_default=''
while (($#)); do
	case "$1" in
	--default)
		if [ "$#" -lt 2 ] || [ -z "$2" ]; then
			printf '%s\n' 'usage: sweep-plan.sh [--default <branch>]' >&2
			exit 2
		fi
		if [ -n "$explicit_default" ]; then
			printf '%s\n' '--default may be provided only once' >&2
			exit 2
		fi
		explicit_default="$2"
		shift 2
		;;
	*)
		printf 'unknown argument: %s\n' "$1" >&2
		printf '%s\n' 'usage: sweep-plan.sh [--default <branch>]' >&2
		exit 2
		;;
	esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	printf '%s\n' 'not inside a git work tree' >&2
	exit 1
fi
if [ -n "$explicit_default" ] && \
	! git check-ref-format --branch "$explicit_default" >/dev/null 2>&1; then
	printf 'invalid explicit default branch: %s\n' "$explicit_default" >&2
	exit 2
fi

plan_tmp="$(mktemp -d "${TMPDIR:-/tmp}/branch-sweep-plan.XXXXXX")" || exit 1
cleanup() {
	rm -rf -- "$plan_tmp" || true
}
exit_on_signal() {
	local status="$1"
	trap - EXIT HUP INT TERM
	cleanup
	exit "$status"
}
trap cleanup EXIT
trap 'exit_on_signal 129' HUP
trap 'exit_on_signal 130' INT
trap 'exit_on_signal 143' TERM

transform_failed() {
	printf 'failed to construct complete sweep plan: %s\n' "$1" >&2
	exit 1
}

local_branches="$plan_tmp/local-branches"
local_attempt="$plan_tmp/local-attempt"
current_attempt="$plan_tmp/current-attempt"
current_error_file="$plan_tmp/current-error"
origin_fetch_urls_attempt="$plan_tmp/origin-fetch-urls-attempt"
origin_push_urls_attempt="$plan_tmp/origin-push-urls-attempt"
remote_branches="$plan_tmp/remote-branches"
remote_attempt="$plan_tmp/remote-attempt"
remote_error_file="$plan_tmp/remote-error"
default_attempt="$plan_tmp/default-attempt"
default_error_file="$plan_tmp/default-error"
github_default_attempt="$plan_tmp/github-default-attempt"
merged_attempt="$plan_tmp/merged-attempt"
merged_error_file="$plan_tmp/merged-error"
merged_branches="$plan_tmp/merged-branches"
fallback_merged="$plan_tmp/fallback-merged"
local_candidate_names="$plan_tmp/local-candidate-names"
local_candidate_names_sorted="$plan_tmp/local-candidate-names-sorted"
local_candidates="$plan_tmp/local-candidates"
local_candidates_filtered="$plan_tmp/local-candidates-filtered"
local_skips="$plan_tmp/local-skips"
remote_candidates="$plan_tmp/remote-candidates"
remote_skips="$plan_tmp/remote-skips"
removable_worktrees="$plan_tmp/removable-worktrees"
blocking_worktrees="$plan_tmp/blocking-worktrees"
clean_worktree_records="$plan_tmp/clean-worktree-records"
blocked_candidate_reasons="$plan_tmp/blocked-candidate-reasons"
blocked_candidate_reasons_sorted="$plan_tmp/blocked-candidate-reasons-sorted"
all_prunable_worktrees="$plan_tmp/all-prunable-worktrees"
retained_worktrees="$plan_tmp/retained-worktrees"
worktree_records="$plan_tmp/worktree-records"
worktree_error_file="$plan_tmp/worktree-error"
worktree_status_attempt="$plan_tmp/worktree-status-attempt"
worktree_status_error_file="$plan_tmp/worktree-status-error"
worktree_gitlinks_attempt="$plan_tmp/worktree-gitlinks-attempt"
plan_output="$plan_tmp/plan-output"

: >"$remote_branches"
: >"$merged_branches"
: >"$fallback_merged"
: >"$local_candidate_names"
: >"$local_candidates"
: >"$local_skips"
: >"$remote_candidates"
: >"$remote_skips"
: >"$removable_worktrees"
: >"$blocking_worktrees"
: >"$clean_worktree_records"
: >"$blocked_candidate_reasons"
: >"$all_prunable_worktrees"
: >"$retained_worktrees"

if ! git for-each-ref --format='%(objectname)%09%(refname:lstrip=2)' refs/heads/ \
	>"$local_attempt"; then
	printf '%s\n' 'failed to read local branch refs' >&2
	exit 1
fi
LC_ALL=C sort -u "$local_attempt" >"$local_branches"
if ! git branch --show-current >"$current_attempt" 2>"$current_error_file"; then
	IFS= read -r current_error <"$current_error_file" || true
	printf 'failed to read current branch: %s\n' \
		"${current_error:-unknown error}" >&2
	exit 1
fi
IFS= read -r current <"$current_attempt" || current=''

# bind one fetch URL and one push URL to the same canonical GitHub repository
canonicalize_github_url() {
	local url="$1"
	local authority=''
	local path=''
	local host=''
	local transport=''
	case "$url" in
	https://* | http://* | ssh://* | git://*)
		transport="${url%%://*}"
		url="${url#*://}"
		authority="${url%%/*}"
		[ "$authority" != "$url" ] || return 1
		case "$transport:$authority" in
		http:*@* | https:*@* | git:*@*) return 1 ;;
		ssh:git@* | ssh:*@*)
			[ "${authority%%@*}" = 'git' ] || return 1
			;;
		esac
		path="${url#*/}"
		host="${authority##*@}"
		;;
	*://*) return 1 ;;
	*:*)
		authority="${url%%:*}"
		case "$authority" in '' | */*) return 1 ;; esac
		case "$authority" in
		git@* | *@*) [ "${authority%%@*}" = 'git' ] || return 1 ;;
		esac
		path="${url#*:}"
		host="${authority##*@}"
		;;
	*) return 1 ;;
	esac
	while [[ "$path" == /* ]]; do
		path="${path#/}"
	done
	path="${path%/}"
	path="${path%.git}"
	canonical_owner="${path%%/*}"
	canonical_repo="${path#*/}"
	[ "$canonical_repo" != "$path" ] || return 1
	case "$canonical_repo" in '' | */*) return 1 ;; esac
	case "$canonical_owner" in '' | . | ..) return 1 ;; esac
	case "$canonical_repo" in . | ..) return 1 ;; esac
	if ! printf '%s\n' "$host" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$|^[A-Za-z0-9]$' || \
		! printf '%s\n' "$canonical_owner" | grep -Eq '^[A-Za-z0-9_.-]+$' || \
		! printf '%s\n' "$canonical_repo" | grep -Eq '^[A-Za-z0-9_.-]+$'; then
		return 1
	fi
	if ! canonical_host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')" || \
		! canonical_owner="$(printf '%s' "$canonical_owner" | tr '[:upper:]' '[:lower:]')" || \
		! canonical_repo="$(printf '%s' "$canonical_repo" | tr '[:upper:]' '[:lower:]')"; then
		transform_failed 'origin identity normalization failed'
	fi
}

origin_identity_resolved=0
origin_github_bound=0
origin_identity_error=''
origin_github_proof=''
origin_host=''
origin_owner=''
origin_repo=''
origin_fetch_url=''
origin_push_url=''
fetch_url_count=0
push_url_count=0
if git remote get-url --all origin >"$origin_fetch_urls_attempt" 2>/dev/null; then
	while IFS= read -r candidate_url || [ -n "$candidate_url" ]; do
		origin_fetch_url="$candidate_url"
		fetch_url_count=$((fetch_url_count + 1))
	done <"$origin_fetch_urls_attempt"
fi
if git remote get-url --push --all origin >"$origin_push_urls_attempt" 2>/dev/null; then
	while IFS= read -r candidate_url || [ -n "$candidate_url" ]; do
		origin_push_url="$candidate_url"
		push_url_count=$((push_url_count + 1))
	done <"$origin_push_urls_attempt"
fi
if [ "$fetch_url_count" -ne 1 ] || [ "$push_url_count" -ne 1 ]; then
	origin_identity_error='origin must have exactly one fetch URL and one push URL'
elif canonicalize_github_url "$origin_fetch_url"; then
	fetch_identity="$canonical_host/$canonical_owner/$canonical_repo"
	if canonicalize_github_url "$origin_push_url"; then
		push_identity="$canonical_host/$canonical_owner/$canonical_repo"
		if [ "$fetch_identity" = "$push_identity" ]; then
			origin_identity_resolved=1
			origin_host="${push_identity%%/*}"
			origin_owner_repo="${push_identity#*/}"
			origin_owner="${origin_owner_repo%%/*}"
			origin_repo="${origin_owner_repo#*/}"
			github_repo_endpoint="repos/$origin_owner/$origin_repo"
			printf -v origin_push_url_display '%q' "$origin_push_url"
			if [ "$origin_host" = 'github.com' ]; then
				origin_github_bound=1
				origin_github_proof='canonical github.com origin fetch/push identity'
			fi
		else
			origin_identity_error='origin fetch and push URLs resolve to different repositories'
		fi
	else
		origin_identity_error='origin push URL is not a supported GitHub URL'
	fi
else
	origin_identity_error='origin fetch URL is not a supported GitHub URL'
fi

# query the exact configured push destination without changing tracking refs
remote_complete=0
remote_error=''
if [ "$origin_identity_resolved" -eq 1 ] && \
	git ls-remote --heads "$origin_push_url" >"$remote_attempt" 2>"$remote_error_file"; then
	remote_complete=1
	while IFS=$'\t' read -r object ref; do
		case "$ref" in
		refs/heads/*) printf '%s\t%s\n' "$object" "${ref#refs/heads/}" ;;
		esac
	done <"$remote_attempt" | LC_ALL=C sort -u >"$remote_branches"
else
	if [ "$origin_identity_resolved" -eq 1 ]; then
		IFS= read -r remote_error <"$remote_error_file" || true
	else
		remote_error="$origin_identity_error"
	fi
fi

# prefer the exact push destination's live HEAD, then its concrete GitHub API endpoint
remote_head_exists() {
	local branch="$1"
	local match=''
	if ! match="$(awk -F '\t' -v branch="$branch" \
		'$2 == branch { print "found"; exit }' "$remote_branches")"; then
		transform_failed 'remote-head lookup failed'
	fi
	[ "$match" = 'found' ]
}

authoritative_default=''
authoritative_default_source=''
if [ "$origin_identity_resolved" -eq 1 ] && \
	git ls-remote --symref "$origin_push_url" HEAD >"$default_attempt" 2>"$default_error_file"; then
	while IFS=$'\t' read -r ref target; do
		if [ "$target" = 'HEAD' ] && [[ "$ref" == 'ref: refs/heads/'* ]]; then
			candidate_default="${ref#ref: refs/heads/}"
			if git check-ref-format --branch "$candidate_default" >/dev/null 2>&1 && \
				{ [ "$remote_complete" -eq 0 ] || remote_head_exists "$candidate_default"; }; then
				authoritative_default="$candidate_default"
				authoritative_default_source='live approved push-destination HEAD via git ls-remote --symref'
			fi
			break
		fi
	done <"$default_attempt"
fi
if [ "$origin_identity_resolved" -eq 1 ] && \
	{ [ -z "$authoritative_default" ] || [ "$origin_github_bound" -eq 0 ]; } && \
	command -v gh >/dev/null 2>&1; then
	if gh api --hostname "$origin_host" "$github_repo_endpoint" --jq '.default_branch' \
		>"$github_default_attempt" 2>/dev/null; then
		origin_github_bound=1
		origin_github_proof='explicit GitHub repository API endpoint'
		github_default=''
		github_default_count=0
		while IFS= read -r candidate_default || [ -n "$candidate_default" ]; do
			github_default="$candidate_default"
			github_default_count=$((github_default_count + 1))
		done <"$github_default_attempt"
		if [ "$github_default_count" -eq 1 ] && \
			git check-ref-format --branch "$github_default" >/dev/null 2>&1 && \
			{ [ "$remote_complete" -eq 0 ] || remote_head_exists "$github_default"; }; then
			if [ -n "$authoritative_default" ] && \
				[ "$authoritative_default" != "$github_default" ]; then
				printf 'live push-destination default %s conflicts with GitHub repository default %s\n' \
					"$authoritative_default" "$github_default" >&2
				exit 1
			elif [ -z "$authoritative_default" ]; then
				authoritative_default="$github_default"
				authoritative_default_source="GitHub repository API for $origin_host/$origin_owner/$origin_repo"
			fi
		fi
	fi
fi

default=''
default_source=''
default_confirmed=0
if [ -n "$explicit_default" ]; then
	if [ -n "$authoritative_default" ] && \
		[ "$explicit_default" != "$authoritative_default" ]; then
		printf 'explicit default %s conflicts with authoritative default %s (%s)\n' \
			"$explicit_default" "$authoritative_default" \
			"$authoritative_default_source" >&2
		exit 1
	fi
	if [ "$remote_complete" -eq 1 ]; then
		if ! remote_head_exists "$explicit_default"; then
			printf 'explicit default branch is absent from live push-destination heads: %s\n' \
				"$explicit_default" >&2
			exit 1
		fi
	elif ! git show-ref --verify --quiet "refs/heads/$explicit_default" && \
		! git show-ref --verify --quiet "refs/remotes/origin/$explicit_default"; then
		printf 'explicit default branch is not present in readable local refs: %s\n' \
			"$explicit_default" >&2
		exit 1
	fi
	default="$explicit_default"
	default_confirmed=1
	if [ -n "$authoritative_default" ]; then
		default_source="complete (explicit --default agrees with $authoritative_default_source)"
	else
		default_source='complete (explicit --default; authoritative discovery unavailable)'
	fi
elif [ -n "$authoritative_default" ]; then
	default="$authoritative_default"
	default_confirmed=1
	default_source="complete ($authoritative_default_source)"
else
	stale_default=''
	stale_default_status=0
	if stale_default="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)"; then
		default="${stale_default#origin/}"
	else
		stale_default_status=$?
		[ "$stale_default_status" -eq 1 ] || transform_failed 'stale default orientation lookup failed'
	fi
	if [ -n "$default" ]; then
		default_source='incomplete orientation only (stale local origin/HEAD; rerun with --default <branch>)'
	else
		default='main'
		default_source='incomplete orientation only (main assumed; rerun with --default <branch>)'
	fi
fi

protection_reason() {
	local branch="$1"
	if [ "$branch" = "$default" ]; then
		if [ "$default_confirmed" -eq 1 ]; then
			printf '%s\n' 'default branch'
		else
			printf '%s\n' 'possible default branch (unconfirmed orientation)'
		fi
		return 0
	fi
	if [ -n "$current" ] && [ "$branch" = "$current" ]; then
		printf '%s\n' 'current branch'
		return 0
	fi
	local protected_status=0
	if printf '%s\n' "$branch" | grep -Eq "$PROTECTED_RE"; then
		printf '%s\n' 'protected branch family'
		return 0
	else
		protected_status=$?
	fi
	[ "$protected_status" -eq 1 ] || transform_failed 'protected-branch lookup failed'
	return 1
}

# gh writes into an attempt file; a failed page discards the whole partial result
github_complete=0
github_error=''
if [ "$origin_identity_resolved" -eq 1 ] && command -v gh >/dev/null 2>&1; then
	if gh api --hostname "$origin_host" \
		"$github_repo_endpoint/pulls?state=closed&per_page=100" --paginate \
		--jq '.[] | select(.merged_at != null and .head.sha != null and .head.repo.full_name == .base.repo.full_name) | [.head.ref, .head.sha, (.number | tostring)] | @tsv' \
		>"$merged_attempt" 2>"$merged_error_file"; then
		github_complete=1
		origin_github_bound=1
		origin_github_proof='explicit paginated GitHub repository API endpoint'
		LC_ALL=C sort -t $'\t' -k1,1 -k2,2 -u "$merged_attempt" >"$merged_branches"
	else
		IFS= read -r github_error <"$merged_error_file" || true
	fi
elif [ "$origin_identity_resolved" -eq 0 ]; then
		github_error="$origin_identity_error"
else
		github_error='gh is unavailable'
fi

fallback_complete=0
fallback_target=''
fallback_error=''
if [ "$github_complete" -eq 0 ] && [ "$default_confirmed" -eq 1 ] && \
	[ "$origin_github_bound" -eq 1 ]; then
	if [ "$remote_complete" -ne 1 ]; then
		fallback_error='live push-destination heads unavailable; default OID cannot be bound'
	else
		if ! fallback_target="$(awk -F '\t' -v branch="$default" \
			'$2 == branch { print $1; exit }' "$remote_branches")"; then
			transform_failed 'live default OID lookup failed'
		fi
		if [ -z "$fallback_target" ]; then
			fallback_error='live push-destination default OID unavailable'
		elif ! git cat-file -e "$fallback_target^{commit}" 2>/dev/null; then
			fallback_error='live push-destination default OID is not locally readable'
		fi
	fi
	if [ -n "$fallback_target" ] && [ -z "$fallback_error" ] && \
		git branch --merged "$fallback_target" --format='%(refname:lstrip=2)' \
			>"$fallback_merged" 2>/dev/null; then
		fallback_complete=1
		LC_ALL=C sort -u "$fallback_merged" -o "$fallback_merged"
	else
		: >"$fallback_merged"
		[ -n "$fallback_error" ] || fallback_error='commit-ancestry query failed'
	fi
elif [ "$github_complete" -eq 0 ] && [ "$origin_github_bound" -eq 0 ]; then
	fallback_error='origin GitHub repository identity is unconfirmed'
fi

merged_pr_for_tip() {
	local branch="$1"
	local object="$2"
	local match=''
	if ! match="$(awk -F '\t' -v branch="$branch" -v object="$object" \
		'$1 == branch && $2 == object { print $3; exit }' "$merged_branches")"; then
		transform_failed 'merged PR tip lookup failed'
	fi
	printf '%s' "$match"
}

has_merged_pr_history() {
	local branch="$1"
	local match=''
	if ! match="$(awk -F '\t' -v branch="$branch" \
		'$1 == branch { print "found"; exit }' "$merged_branches")"; then
		transform_failed 'merged PR history lookup failed'
	fi
	[ "$match" = 'found' ]
}

file_has_line() {
	local line="$1"
	local file="$2"
	local status=0
	if grep -Fxq -- "$line" "$file"; then
		return 0
	else
		status=$?
	fi
	[ "$status" -eq 1 ] || transform_failed 'exact-name lookup failed'
	return 1
}

blocked_candidate_exists() {
	local branch="$1"
	local match=''
	if ! match="$(awk -F '\t' -v branch="$branch" \
		'$1 == branch { print "found"; exit }' "$blocked_candidate_reasons_sorted")"; then
		transform_failed 'blocked-candidate lookup failed'
	fi
	[ "$match" = 'found' ]
}

short_object() {
	printf '%.12s' "$1"
}

# classify every local branch so protected, current & unmerged skips stay visible
while IFS=$'\t' read -r object branch; do
	[ -z "$branch" ] && continue
	if reason="$(protection_reason "$branch")"; then
		printf '  %s  (%s)\n' "$branch" "$reason" >>"$local_skips"
		continue
	fi
	if [ "$origin_github_bound" -eq 0 ]; then
		printf '  %s  (origin GitHub repository identity unconfirmed; deletion planning suppressed)\n' \
			"$branch" >>"$local_skips"
		continue
	fi
	if [ "$default_confirmed" -eq 0 ]; then
		printf '  %s  (default branch unconfirmed; deletion planning suppressed; rerun with --default <branch>)\n' \
			"$branch" >>"$local_skips"
		continue
	fi
	if [ "$github_complete" -eq 1 ]; then
		pr="$(merged_pr_for_tip "$branch" "$object")"
		if [ -n "$pr" ]; then
			printf '  %s  (OID %s; PR #%s)\n' \
				"$branch" "$object" "$pr" >>"$local_candidates"
			printf '%s\n' "$branch" >>"$local_candidate_names"
		elif has_merged_pr_history "$branch"; then
			printf '  %s  (merged PR history found, but current tip %s does not match a merged PR head)\n' \
				"$branch" "$(short_object "$object")" >>"$local_skips"
		else
			printf '  %s  (no merged PR found on GitHub)\n' "$branch" >>"$local_skips"
		fi
	elif file_has_line "$branch" "$fallback_merged"; then
		printf '  %s  (OID %s; merged into %s; local fallback)\n' \
			"$branch" "$object" "$default" >>"$local_candidates"
		printf '%s\n' "$branch" >>"$local_candidate_names"
	elif [ "$fallback_complete" -eq 1 ]; then
		printf '  %s  (not merged into %s; fallback cannot verify squash/rebase PRs)\n' \
			"$branch" "$default" >>"$local_skips"
	else
		printf '  %s  (merge status unavailable; %s)\n' \
			"$branch" "${fallback_error:-GitHub discovery failed}" >>"$local_skips"
	fi
done <"$local_branches"

# remote candidates come only from the exact push target's GitHub-confirmed live heads
while IFS=$'\t' read -r object branch; do
	[ -z "$branch" ] && continue
	if reason="$(protection_reason "$branch")"; then
		printf '  origin/%s  (%s)\n' "$branch" "$reason" >>"$remote_skips"
		continue
	fi
	if [ "$origin_github_bound" -eq 0 ]; then
		printf '  origin/%s  (origin GitHub repository identity unconfirmed; deletion planning suppressed)\n' \
			"$branch" >>"$remote_skips"
		continue
	fi
	if [ "$default_confirmed" -eq 0 ]; then
		printf '  origin/%s  (default branch unconfirmed; deletion planning suppressed; rerun with --default <branch>)\n' \
			"$branch" >>"$remote_skips"
		continue
	fi
	if [ "$github_complete" -eq 1 ]; then
		pr="$(merged_pr_for_tip "$branch" "$object")"
		if [ -n "$pr" ]; then
			printf '  origin/%s  (OID %s; PR #%s)\n' \
				"$branch" "$object" "$pr" >>"$remote_candidates"
		elif has_merged_pr_history "$branch"; then
			printf '  origin/%s  (merged PR history found, but current tip %s does not match a merged PR head)\n' \
				"$branch" "$(short_object "$object")" >>"$remote_skips"
		else
			printf '  origin/%s  (no merged PR found on GitHub)\n' \
				"$branch" >>"$remote_skips"
		fi
	else
		printf '  origin/%s  (remote merge status unconfirmed; GitHub discovery unavailable)\n' \
			"$branch" >>"$remote_skips"
	fi
done <"$remote_branches"

LC_ALL=C sort -u "$local_candidate_names" >"$local_candidate_names_sorted"

worktree_path=''
worktree_branch=''
worktree_prunable=''
worktree_locked=''

flush_worktree() {
	[ -z "$worktree_path" ] && return
	local label='<detached>'
	local lock_note=''
	local display_path
	local display_prunable=''
	local display_locked=''
	local cleanliness_reason=''
	local has_gitlink=0
	local has_ignored=0
	local has_other_status=0
	printf -v display_path '%q' "$worktree_path"
	[ -n "$worktree_branch" ] && label="$worktree_branch"
	[ -n "$worktree_prunable" ] && printf -v display_prunable '%q' "$worktree_prunable"
	if [ -n "$worktree_locked" ]; then
		printf -v display_locked '%q' "$worktree_locked"
		lock_note="; locked: $display_locked"
	fi
	if [ -n "$worktree_prunable" ]; then
		if [ -n "$worktree_branch" ] && \
			file_has_line "$worktree_branch" "$local_candidate_names_sorted"; then
			printf '  %s  (%s; local sweep candidate; %s%s)\n' \
				"$display_path" "$label" "$display_prunable" "$lock_note" \
				>>"$all_prunable_worktrees"
		else
			printf '  %s  (%s; not a local sweep candidate; %s%s)\n' \
				"$display_path" "$label" "$display_prunable" "$lock_note" \
				>>"$all_prunable_worktrees"
		fi
	elif [ -n "$worktree_branch" ] && \
		file_has_line "$worktree_branch" "$local_candidate_names_sorted"; then
		if [ -n "$worktree_locked" ]; then
			cleanliness_reason='worktree is locked'
		elif ! git --no-optional-locks -C "$worktree_path" status --porcelain=v2 -z \
			--untracked-files=all --ignored=matching --ignore-submodules=none \
			>"$worktree_status_attempt" 2>"$worktree_status_error_file"; then
			cleanliness_reason='worktree status query failed'
		else
			while IFS= read -r -d '' status_entry; do
				case "$status_entry" in
				'! '*) has_ignored=1 ;;
				*) has_other_status=1 ;;
				esac
			done <"$worktree_status_attempt"
			if ! git -C "$worktree_path" ls-files --stage -z \
				>"$worktree_gitlinks_attempt" 2>/dev/null; then
				cleanliness_reason='submodule-surface query failed'
			else
				while IFS= read -r -d '' index_entry; do
					case "$index_entry" in 160000\ *) has_gitlink=1 ;; esac
				done <"$worktree_gitlinks_attempt"
				if [ "$has_gitlink" -eq 1 ]; then
					cleanliness_reason='registered submodule surface cannot be proven recursively clean'
				elif [ "$has_ignored" -eq 1 ] && [ "$has_other_status" -eq 0 ]; then
					cleanliness_reason='ignored files present'
				elif [ "$has_ignored" -eq 1 ]; then
					cleanliness_reason='tracked, untracked, or ignored status entries present'
				elif [ "$has_other_status" -eq 1 ]; then
					cleanliness_reason='tracked or untracked status entries present'
				fi
			fi
		fi
		if [ -n "$cleanliness_reason" ]; then
			printf '  %s  (%s; blocks local deletion; not removable: %s%s)\n' \
				"$display_path" "$label" "$cleanliness_reason" "$lock_note" \
				>>"$blocking_worktrees"
			printf '%s\t%s\n' "$worktree_branch" \
				"candidate worktree is not removable: $cleanliness_reason" \
				>>"$blocked_candidate_reasons"
		else
			printf '%s\t%s\n' "$worktree_branch" "$display_path" \
				>>"$clean_worktree_records"
		fi
	else
		printf '  %s  (%s; not held by a local sweep candidate%s)\n' \
			"$display_path" "$label" "$lock_note" >>"$retained_worktrees"
	fi
	worktree_path=''
	worktree_branch=''
	worktree_prunable=''
	worktree_locked=''
}

# nul-delimited porcelain preserves every legal worktree-path byte
worktree_complete=0
worktree_error=''
if git worktree list --porcelain -z >"$worktree_records" 2>"$worktree_error_file"; then
	worktree_complete=1
else
	IFS= read -r worktree_error <"$worktree_error_file" || true
	: >"$worktree_records"
fi
while IFS= read -r -d '' field; do
	case "$field" in
	'') flush_worktree ;;
	worktree\ *) worktree_path="${field#worktree }" ;;
	branch\ refs/heads/*) worktree_branch="${field#branch refs/heads/}" ;;
	prunable\ *) worktree_prunable="${field#prunable }" ;;
	locked) worktree_locked='no reason supplied' ;;
	locked\ *) worktree_locked="${field#locked }" ;;
	esac
done <"$worktree_records"
flush_worktree

# incomplete or blocking worktree evidence suppresses the affected local CAS
if [ "$worktree_complete" -eq 0 ]; then
	while IFS= read -r blocked_branch; do
		[ -z "$blocked_branch" ] && continue
		printf '%s\t%s\n' "$blocked_branch" \
			'worktree discovery incomplete; local deletion suppressed' \
			>>"$blocked_candidate_reasons"
	done <"$local_candidate_names_sorted"
fi
LC_ALL=C sort -t $'\t' -k1,1 -u "$blocked_candidate_reasons" \
	>"$blocked_candidate_reasons_sorted"
while IFS=$'\t' read -r clean_branch clean_path; do
	[ -z "$clean_branch" ] && continue
	if blocked_candidate_exists "$clean_branch"; then
		printf '  %s  (%s; blocks local deletion; not removable: another worktree for this branch is not removable)\n' \
			"$clean_path" "$clean_branch" >>"$blocking_worktrees"
	else
		printf '  %s  (%s; unlocked and proven clean; removable only after approval)\n' \
			"$clean_path" "$clean_branch" >>"$removable_worktrees"
	fi
done <"$clean_worktree_records"
cp "$local_candidates" "$local_candidates_filtered"
while IFS=$'\t' read -r blocked_branch blocked_reason; do
	[ -z "$blocked_branch" ] && continue
	awk -v prefix="  $blocked_branch  (" 'index($0, prefix) != 1' \
		"$local_candidates_filtered" >"$local_attempt"
	mv "$local_attempt" "$local_candidates_filtered"
	printf '  %s  (%s)\n' "$blocked_branch" "$blocked_reason" >>"$local_skips"
done <"$blocked_candidate_reasons_sorted"
mv "$local_candidates_filtered" "$local_candidates"

print_section() {
	local title="$1"
	local file="$2"
	printf '=== %s ===\n' "$title"
	if [ -s "$file" ]; then
		cat "$file"
	else
		printf '%s\n' '  (none)'
	fi
	printf '\n'
}

# render into a private file so any late failure exposes no partial plan
{
	merged_count="$(wc -l <"$merged_branches" | tr -d ' ')"
	printf 'default branch : %s\n' "$default"
	printf 'current branch : %s\n' "${current:-<detached>}"
	printf '\n=== DISCOVERY COMPLETENESS ===\n'
	printf '%s\n' '  local refs      : complete (local for-each-ref)'
	printf '  default branch  : %s\n' "$default_source"
	if [ "$origin_github_bound" -eq 1 ]; then
		printf '  origin binding  : complete (%s/%s/%s; %s; exact push target %s)\n' \
			"$origin_host" "$origin_owner" "$origin_repo" "$origin_github_proof" \
			"$origin_push_url_display"
	elif [ "$origin_identity_resolved" -eq 1 ]; then
		printf '  origin binding  : incomplete (%s/%s/%s resolved, but GitHub API binding unconfirmed)\n' \
			"$origin_host" "$origin_owner" "$origin_repo"
	else
		printf '  origin binding  : incomplete (%s)\n' "$origin_identity_error"
	fi
	if [ "$remote_complete" -eq 1 ]; then
		printf '%s\n' '  remote heads    : complete (live exact push target via git ls-remote --heads)'
	else
		printf '  remote heads    : incomplete (exact push-target query failed: %s)\n' \
			"${remote_error:-unknown error}"
	fi
	if [ "$worktree_complete" -eq 1 ]; then
		printf '%s\n' '  worktree records: complete (local git worktree list --porcelain -z)'
	else
		printf '  worktree records: incomplete (local query failed: %s)\n' \
			"${worktree_error:-unknown error}"
	fi
	if [ "$github_complete" -eq 1 ]; then
		printf '  merged PR heads : complete (%s unique ref+SHA records from all gh api --paginate pages)\n' \
			"$merged_count"
	else
		printf '  merged PR heads : incomplete (%s; any partial GitHub output was discarded)\n' \
			"${github_error:-GitHub query failed}"
		if [ "$default_confirmed" -eq 0 ]; then
			printf '%s\n' '  local fallback  : suppressed (default branch unconfirmed; rerun with --default <branch>)'
		elif [ "$fallback_complete" -eq 1 ]; then
			printf '  local fallback  : complete commit-ancestry query against live default OID %s; best-effort for squash/rebase merges\n' \
				"$fallback_target"
		else
			printf '  local fallback  : unavailable (%s)\n' \
				"${fallback_error:-default OID unavailable}"
		fi
	fi
	printf '\n'

	print_section 'LOCAL CANDIDATES (merged branches to sweep)' "$local_candidates"
	print_section 'REMOTE CANDIDATES (live origin heads to sweep)' "$remote_candidates"
	print_section 'LOCAL SKIPS' "$local_skips"
	print_section 'REMOTE SKIPS' "$remote_skips"
	print_section 'WORKTREES REMOVABLE AFTER APPROVAL' "$removable_worktrees"
	print_section 'WORKTREES BLOCKING LOCAL SWEEP CANDIDATES' "$blocking_worktrees"
	print_section 'ALL PRUNABLE WORKTREE RECORDS' "$all_prunable_worktrees"
	print_section 'WORKTREES RETAINED' "$retained_worktrees"

	printf '%s\n' 'note: worktree paths are reversible shell-escaped tokens; this script changes no refs or worktrees. review the plan; deletion and pruning require approval.'
} >"$plan_output"
cat "$plan_output"
