#!/usr/bin/env bash
# skills/branch-sweep/scripts/sweep-plan.sh
# read-only branch, tracking-ref & worktree cleanup inventory with exact-tip evidence

set -euo pipefail
export GIT_NO_LAZY_FETCH=1
export GIT_OPTIONAL_LOCKS=0

# protected branch names that are never swept
PROTECTED_RE='^(main|master|develop|development|prod|production|staging|release(/.*)?|hotfix(/.*)?)$'

explicit_default=''
scan_roots=()
scan_root_count=0
usage='usage: sweep-plan.sh [--default <branch>] [--scan-root <path>]...'
while (($#)); do
	case "$1" in
	--default)
		if [ "$#" -lt 2 ] || [ -z "$2" ]; then
			printf '%s\n' "$usage" >&2
			exit 2
		fi
		if [ -n "$explicit_default" ]; then
			printf '%s\n' '--default may be provided only once' >&2
			exit 2
		fi
		explicit_default="$2"
		shift 2
		;;
	--scan-root)
		if [ "$#" -lt 2 ] || [ -z "$2" ]; then
			printf '%s\n' "$usage" >&2
			exit 2
		fi
		scan_roots[$scan_root_count]="$2"
		scan_root_count=$((scan_root_count + 1))
		shift 2
		;;
	*)
		printf 'unknown argument: %s\n' "$1" >&2
		printf '%s\n' "$usage" >&2
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
path_attempt="$plan_tmp/path-attempt"
tracking_refs="$plan_tmp/tracking-refs"
tracking_attempt="$plan_tmp/tracking-attempt"
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
if ! git for-each-ref --format='%(objectname)%09%(refname)%09%(symref)' refs/remotes/ \
	>"$tracking_attempt"; then
	transform_failed 'remote-tracking ref inventory failed'
fi
LC_ALL=C sort -u "$tracking_attempt" >"$tracking_refs"
if ! git branch --show-current >"$current_attempt" 2>"$current_error_file"; then
	IFS= read -r current_error <"$current_error_file" || true
	printf 'failed to read current branch: %s\n' \
		"${current_error:-unknown error}" >&2
	exit 1
fi
IFS= read -r current <"$current_attempt" || current=''

# retain trailing newlines in filesystem paths while removing Git's one terminator
read_path_output() {
	path_value=''
	IFS= read -r -d '' path_value <"$path_attempt" || true
	path_value="${path_value%$'\n'}"
	[ -n "$path_value" ]
}
git rev-parse --path-format=absolute --show-toplevel >"$path_attempt"
read_path_output || transform_failed 'invoking worktree path unavailable'
(cd -- "$path_value" && pwd -P) >"$path_attempt"
read_path_output || transform_failed 'invoking worktree path resolution failed'
invoking_root="$path_value"
git rev-parse --path-format=absolute --git-common-dir >"$path_attempt"
read_path_output || transform_failed 'repository common directory unavailable'
(cd -- "$path_value" && pwd -P) >"$path_attempt"
read_path_output || transform_failed 'repository common directory resolution failed'
common_dir="$path_value"
original_branch=''
if original_branch="$(git --git-dir "$common_dir" symbolic-ref -q HEAD 2>/dev/null)"; then
	case "$original_branch" in
	refs/heads/*) original_branch="${original_branch#refs/heads/}" ;;
	*) transform_failed 'unexpected original checkout HEAD binding' ;;
	esac
else
	original_branch_status=$?
	[ "$original_branch_status" -eq 1 ] || transform_failed 'original checkout branch query failed'
fi

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

# ancestry is a separate evidence lane, including when complete PR discovery has no match
fallback_complete=0
fallback_target=''
fallback_error=''
if [ "$default_confirmed" -eq 1 ] && [ "$origin_github_bound" -eq 1 ]; then
	if [ "$remote_complete" -ne 1 ]; then
		fallback_error='live push-destination heads unavailable; default OID cannot be bound'
	else
		fallback_target="$(awk -F '\t' -v branch="$default" '$2 == branch { print $1; exit }' "$remote_branches")"
		if [ -z "$fallback_target" ]; then
			fallback_error='live push-destination default OID unavailable'
		elif ! git cat-file -e "$fallback_target^{commit}" 2>/dev/null; then
			fallback_error='live push-destination default OID is not locally readable'
		else
			fallback_complete=1
		fi
	fi
elif [ "$origin_github_bound" -eq 0 ]; then
	fallback_error='origin GitHub repository identity is unconfirmed'
else
	fallback_error='default branch unconfirmed'
fi

local_inventory="$plan_tmp/local-inventory"
remote_inventory="$plan_tmp/remote-inventory"
tracking_inventory="$plan_tmp/tracking-inventory"
registered_inventory="$plan_tmp/registered-inventory"
discovered_inventory="$plan_tmp/discovered-inventory"
conditional_outputs="$plan_tmp/conditional-outputs"
tracking_candidates="$plan_tmp/tracking-candidates"
conditional_tracking="$plan_tmp/conditional-tracking"
prune_holds="$plan_tmp/prune-holds"
remote_candidate_names="$plan_tmp/remote-candidate-names"
tip_metadata_file="$plan_tmp/tip-metadata"
tip_count_attempt="$plan_tmp/tip-count-attempt"
all_tips="$plan_tmp/all-tips"
duplicate_tips="$plan_tmp/duplicate-tips"
registered_paths="$plan_tmp/registered-paths"
visited_paths="$plan_tmp/visited-paths"
scan_attempt="$plan_tmp/scan-attempt"
for file in "$local_inventory" "$remote_inventory" "$tracking_inventory" \
	"$registered_inventory" "$discovered_inventory" "$conditional_outputs" \
	"$tracking_candidates" "$conditional_tracking" "$prune_holds" "$remote_candidate_names" \
	"$tip_metadata_file" "$all_tips" "$duplicate_tips" "$registered_paths" "$visited_paths"; do
	: >"$file"
done

valid_object() {
	[[ "$1" =~ ^[0-9a-fA-F]{40}$ || "$1" =~ ^[0-9a-fA-F]{64}$ ]]
}

file_has_line() {
	local status=0
	if grep -Fxq -- "$1" "$2"; then
		return 0
	else
		status=$?
	fi
	[ "$status" -eq 1 ] || transform_failed 'exact-name lookup failed'
	return 1
}

path_in_file() {
	local entry=''
	while IFS= read -r -d '' entry; do
		[ "$entry" != "$1" ] || return 0
	done <"$2"
	return 1
}

merged_pr_for_tip() {
	local branch="$1"
	local object="$2"
	awk -F '\t' -v branch="$branch" -v object="$object" \
		'$2 == object && ($1 == branch || branch == "") { print $3; exit }' "$merged_branches"
}

has_merged_pr_history() {
	local match=''
	match="$(awk -F '\t' -v branch="$1" '$1 == branch { print "found"; exit }' "$merged_branches")" \
		|| transform_failed 'merged PR history lookup failed'
	[ "$match" = 'found' ]
}

# cache only commit metadata and graph counts, never inspect feature content
load_tip_metadata() {
	local object="$1"
	local row=''
	local ancestry_status=0
	local tip_date=''
	local cached_object=''
	valid_object "$object" || transform_failed 'invalid object ID in inventory'
	row="$(awk -F '\t' -v object="$object" '$1 == object { print; exit }' "$tip_metadata_file")" \
		|| transform_failed 'tip metadata lookup failed'
	if [ -n "$row" ]; then
		IFS=$'\t' read -r cached_object tip_relation tip_ahead tip_behind tip_date <<<"$row"
	else
		tip_relation='unavailable'
		tip_ahead='?'
		tip_behind='?'
		tip_date='unreadable'
		if git cat-file -e "$object^{commit}" 2>/dev/null; then
			tip_date="$(git show --no-patch --format=%cI "$object")" \
				|| transform_failed 'commit date query failed'
			if [ "$fallback_complete" -eq 1 ]; then
				if git merge-base --is-ancestor "$object" "$fallback_target"; then
					tip_relation='ancestor'
				else
					ancestry_status=$?
					if [ "$ancestry_status" -eq 1 ]; then
						tip_relation='unmerged'
					fi
				fi
				if [ "$tip_relation" != 'unavailable' ]; then
					if git rev-list --left-right --count "$object...$fallback_target" \
						>"$tip_count_attempt" 2>/dev/null; then
						read -r tip_ahead tip_behind <"$tip_count_attempt" \
							|| transform_failed 'commit graph counts unavailable'
						[[ "$tip_ahead" =~ ^[0-9]+$ && "$tip_behind" =~ ^[0-9]+$ ]] \
							|| transform_failed 'invalid commit graph counts'
					else
						tip_relation='unavailable'
						tip_ahead='?'
						tip_behind='?'
					fi
				fi
			fi
		fi
		printf '%s\t%s\t%s\t%s\t%s\n' "$object" "$tip_relation" "$tip_ahead" \
			"$tip_behind" "$tip_date" >>"$tip_metadata_file"
	fi
	tip_summary="OID $object; ahead/behind live default $tip_ahead/$tip_behind; committed $tip_date"
}

classify_tip() {
	local branch="$1"
	local object="$2"
	local pr=''
	tip_evidence=''
	tip_hold=''
	load_tip_metadata "$object"
	if [ "$origin_github_bound" -eq 0 ]; then
		tip_hold='origin GitHub repository identity unconfirmed; deletion planning suppressed'
	elif [ "$default_confirmed" -eq 0 ]; then
		tip_hold='default branch unconfirmed; deletion planning suppressed; rerun with --default <branch>'
	else
		if [ "$github_complete" -eq 1 ]; then
			pr="$(merged_pr_for_tip "$branch" "$object")" \
				|| transform_failed 'merged PR tip lookup failed'
		fi
		if [ -n "$pr" ]; then
			tip_evidence="PR #$pr"
		elif [ "$tip_relation" = 'ancestor' ]; then
			tip_evidence="ancestor of live default $default at $fallback_target"
		elif [ "$github_complete" -eq 1 ] && [ -n "$branch" ] && has_merged_pr_history "$branch"; then
			tip_hold="merged PR history found, but current tip ${object:0:12} does not match a merged PR head"
		elif [ "$github_complete" -eq 1 ]; then
			tip_hold='no merged PR found on GitHub; no confirmed live-default ancestry; hold unique or unverified tip'
		elif [ "$fallback_complete" -eq 1 ] && [ "$tip_relation" = 'unmerged' ]; then
			tip_hold="not merged into $default; fallback cannot verify squash/rebase PRs"
		else
			tip_hold="merge status unavailable; ${fallback_error:-tip ancestry unavailable}"
		fi
	fi
}

# protection failures must abort the main shell, not disappear inside a subshell condition
protected_reason=''
is_protected() {
	local status=0
	protected_reason=''
	if [ "$1" = "$default" ]; then
		protected_reason='default branch'
		[ "$default_confirmed" -eq 1 ] || protected_reason='possible default branch (unconfirmed orientation)'
	elif [ -n "$current" ] && [ "$1" = "$current" ]; then
		protected_reason='current branch'
	elif [ -n "$original_branch" ] && [ "$1" = "$original_branch" ]; then
		protected_reason='original checkout branch'
	elif printf '%s\n' "$1" | grep -Eq "$PROTECTED_RE"; then
		protected_reason='protected branch family'
	else
		status=$?
		[ "$status" -eq 1 ] || transform_failed 'protected-branch lookup failed'
	fi
	[ -n "$protected_reason" ]
}

while IFS=$'\t' read -r object branch; do
	[ -n "$branch" ] || continue
	classify_tip "$branch" "$object"
	if is_protected "$branch"; then
		tip_hold="$protected_reason"
		tip_evidence=''
	fi
	if [ -n "$tip_evidence" ]; then
		if [ "$github_complete" -eq 0 ]; then
			printf '  %s  (OID %s; merged into %s; local fallback)\n' \
				"$branch" "$object" "$default" >>"$local_candidates"
		else
			printf '  %s  (OID %s; %s)\n' "$branch" "$object" "$tip_evidence" >>"$local_candidates"
		fi
		printf '%s\n' "$branch" >>"$local_candidate_names"
	else
		printf '  %s  (%s)\n' "$branch" "$tip_hold" >>"$local_skips"
	fi
	origin_presence='origin presence unconfirmed'
	if [ "$remote_complete" -eq 1 ]; then
		live_object="$(awk -F '\t' -v branch="$branch" '$2 == branch { print $1; exit }' "$remote_branches")"
		if [ -z "$live_object" ]; then
			origin_presence='origin head absent (signal only)'
		elif [ "$live_object" = "$object" ]; then
			origin_presence='origin head present at same OID'
		else
			origin_presence="origin head diverges at OID $live_object"
		fi
	fi
	printf '  %s  (%s; %s)\n' "$branch" "$tip_summary" \
		"$origin_presence; ${tip_evidence:-hold: $tip_hold; loss-risk is metadata only}" >>"$local_inventory"
	printf '%s\tlocal:%s\n' "$object" "$branch" >>"$all_tips"
done <"$local_branches"

# incomplete PR pagination retains the existing fail-closed live-remote boundary
while IFS=$'\t' read -r object branch; do
	[ -n "$branch" ] || continue
	classify_tip "$branch" "$object"
	if is_protected "$branch"; then
		tip_hold="$protected_reason"
		tip_evidence=''
	elif [ "$github_complete" -eq 0 ]; then
		tip_hold='remote merge status unconfirmed; GitHub discovery unavailable'
		tip_evidence=''
	fi
	if [ -n "$tip_evidence" ]; then
		printf '  origin/%s  (OID %s; %s)\n' "$branch" "$object" "$tip_evidence" >>"$remote_candidates"
		printf '%s\n' "$branch" >>"$remote_candidate_names"
	else
		printf '  origin/%s  (%s)\n' "$branch" "$tip_hold" >>"$remote_skips"
	fi
	printf '  refs/heads/%s  (%s; %s)\n' "$branch" "$tip_summary" \
		"${tip_evidence:-hold: $tip_hold}" >>"$remote_inventory"
	printf '%s\tlive-origin:%s\n' "$object" "$branch" >>"$all_tips"
done <"$remote_branches"

while IFS=$'\t' read -r object ref symref; do
	[ -n "$ref" ] || continue
	branch="${ref#refs/remotes/origin/}"
	classify_tip "$branch" "$object"
	tracking_note='other remote; inventory only'
	if [ -n "$symref" ] || [[ "$ref" == */HEAD ]]; then
		tracking_note="symbolic/default tracking ref; inventory only${symref:+; target $symref}"
	elif [[ "$ref" == refs/remotes/origin/* ]]; then
		if is_protected "$branch"; then
			tracking_note="protected tracking ref: $protected_reason"
		elif [ "$remote_complete" -ne 1 ]; then
			tracking_note='live origin heads incomplete; absence unconfirmed; hold'
		else
			live_object="$(awk -F '\t' -v branch="$branch" '$2 == branch { print $1; exit }' "$remote_branches")"
			if [ -z "$live_object" ]; then
				if [ -n "$tip_evidence" ]; then
					tracking_note="absent from complete live origin heads; $tip_evidence"
					printf '  %s  (OID %s; %s; exact-ref cleanup after approval)\n' \
						"$ref" "$object" "$tracking_note" >>"$tracking_candidates"
				else
					tracking_note="origin-gone is a signal only; hold: $tip_hold"
				fi
			elif [ "$live_object" != "$object" ]; then
				tracking_note="divergent from live origin OID $live_object; hold"
			elif file_has_line "$branch" "$remote_candidate_names"; then
				tracking_note='conditional on approved matching live-origin deletion and fresh absence confirmation'
				printf '  %s  (OID %s; %s)\n' "$ref" "$object" "$tracking_note" >>"$conditional_tracking"
			else
				tracking_note='live origin head still present; hold'
			fi
		fi
	fi
	printf '  %s  (%s; %s)\n' "$ref" "$tip_summary" "$tracking_note" >>"$tracking_inventory"
	printf '%s\ttracking:%s\n' "$object" "$ref" >>"$all_tips"
done <"$tracking_refs"
LC_ALL=C sort -u "$local_candidate_names" >"$local_candidate_names_sorted"

worktree_path=''
worktree_branch=''
worktree_head=''
worktree_prunable=''
worktree_locked=''
primary_root=''
worktree_complete=0
worktree_error=''
registered_count=0
unregistered_count=0
scan_complete=1
scan_root_total=0
scan_directory_count=0
conditional_output_count=0

# a name is only a review lead; no ignored entry is ever already-safe content
ignored_output_kind() {
	local relative="$1"
	local leaf="${relative%/}"
	leaf="${leaf##*/}"
	ignored_kind=''
	if [ -d "$worktree_path/$relative" ] && [ ! -L "$worktree_path/$relative" ]; then
		case "$leaf" in
		node_modules | .cache | .next | .nuxt | .turbo | .vite | dist | build | coverage | \
			__pycache__ | .pytest_cache | .mypy_cache | .ruff_cache | target)
			ignored_kind='cache/build directory name; content and regeneration require review'
			;;
		esac
	elif [ -f "$worktree_path/$relative" ] && [ ! -L "$worktree_path/$relative" ]; then
		case "$leaf" in *.tsbuildinfo) ignored_kind='compiler-cache filename; content and regeneration require review' ;; esac
	fi
}

inspect_worktree() {
	local registration="$1"
	local label="${worktree_branch:-<detached>}"
	local display_path=''
	local display_locked=''
	local display_prunable=''
	local lock_note=''
	local cleanliness_reason=''
	local protection=''
	local has_gitlink=0
	local ignored_count=0
	local unknown_ignored=0
	local other_count=0
	local candidate=0
	local status_note='unavailable'
	local inventory_file="$registered_inventory"
	local actual_root=''
	local actual_common=''
	local status_entry=''
	local index_entry=''
	local head_note='HEAD unavailable'
	printf -v display_path '%q' "$worktree_path"
	[ "$registration" = registered ] || inventory_file="$discovered_inventory"
	if [ -n "$worktree_head" ]; then
		classify_tip "$worktree_branch" "$worktree_head"
		head_note="$tip_summary; ${tip_evidence:-hold: $tip_hold}"
		printf '%s\t%s-worktree:%s\n' "$worktree_head" "$registration" "$display_path" >>"$all_tips"
	else
		tip_evidence=''
	fi
	if [ -n "$worktree_branch" ] && file_has_line "$worktree_branch" "$local_candidate_names_sorted"; then
		candidate=1
	fi
	if [ -n "$worktree_locked" ]; then
		printf -v display_locked '%q' "$worktree_locked"
		lock_note="; locked: $display_locked"
	fi
	if [ "$worktree_path" = "$primary_root" ]; then
		protection='original checkout is protected'
	elif [ "$worktree_path" = "$invoking_root" ]; then
		protection='invoking checkout is protected'
	fi
	if [ -d "$worktree_path" ] && [ ! -L "$worktree_path" ]; then
		if [ ! -e "$worktree_path/.git" ] || [ -L "$worktree_path/.git" ]; then
			cleanliness_reason='actual .git metadata missing or symlinked; directory held'
		elif git -C "$worktree_path" rev-parse --path-format=absolute --show-toplevel >"$path_attempt" 2>/dev/null && read_path_output; then
			actual_root="$path_value"
			if [ "$actual_root" != "$worktree_path" ]; then
				cleanliness_reason='Git toplevel does not match worktree directory'
			elif git -C "$worktree_path" rev-parse --path-format=absolute --git-common-dir >"$path_attempt" 2>/dev/null && read_path_output; then
				if (cd -- "$path_value" && pwd -P) >"$path_attempt" && read_path_output; then
					actual_common="$path_value"
				fi
				[ "$actual_common" = "$common_dir" ] || cleanliness_reason='Git common directory does not match repository'
			else
				cleanliness_reason='worktree common-directory query failed'
			fi
		else
			cleanliness_reason='worktree identity query failed'
		fi
		if [ -z "$cleanliness_reason" ]; then
			if ! git --no-optional-locks -C "$worktree_path" status --porcelain=v2 -z \
				--untracked-files=all --ignored=matching --ignore-submodules=none \
				>"$worktree_status_attempt" 2>"$worktree_status_error_file"; then
				cleanliness_reason='worktree status query failed'
			else
				while IFS= read -r -d '' status_entry; do
					case "$status_entry" in
					'! '*)
						ignored_count=$((ignored_count + 1))
						ignored_output_kind "${status_entry#\! }"
						if [ -n "$ignored_kind" ]; then
							local output_path=''
							printf -v output_path '%q' "$worktree_path/${status_entry#\! }"
							printf '  %s  (worktree %s; %s; review and explicit approval required BEFORE ordinary worktree remove; still blocking)\n' \
								"$output_path" "$display_path" "$ignored_kind" >>"$conditional_outputs"
							conditional_output_count=$((conditional_output_count + 1))
						else
							unknown_ignored=$((unknown_ignored + 1))
						fi
						;;
					*) other_count=$((other_count + 1)) ;;
					esac
				done <"$worktree_status_attempt"
				if ! git -C "$worktree_path" ls-files --stage -z >"$worktree_gitlinks_attempt" 2>/dev/null; then
					cleanliness_reason='submodule-surface query failed'
				else
					while IFS= read -r -d '' index_entry; do
						case "$index_entry" in 160000\ *) has_gitlink=1 ;; esac
					done <"$worktree_gitlinks_attempt"
					if [ "$has_gitlink" -eq 1 ]; then
						cleanliness_reason='registered submodule surface cannot be proven recursively clean'
					elif [ "$ignored_count" -gt 0 ] && [ "$other_count" -gt 0 ]; then
						cleanliness_reason='tracked, untracked, or ignored status entries present'
					elif [ "$unknown_ignored" -gt 0 ]; then
						cleanliness_reason='ignored files present'
					elif [ "$ignored_count" -gt 0 ]; then
						cleanliness_reason='conditional ignored-output cleanup requires review and approval'
					elif [ "$other_count" -gt 0 ]; then
						cleanliness_reason='tracked or untracked status entries present'
					fi
				fi
				status_note="tracked/untracked entries $other_count; ignored entries $ignored_count (unknown $unknown_ignored); submodule surface $has_gitlink"
			fi
		fi
	else
		cleanliness_reason='worktree path is missing, not a directory, or symlinked'
	fi
	[ -z "$worktree_locked" ] || cleanliness_reason='worktree is locked'
	[ -z "$protection" ] || cleanliness_reason="$protection"
	[ "$registration" = registered ] || cleanliness_reason="unregistered linked worktree; registration repair and re-plan required${cleanliness_reason:+; $cleanliness_reason}"
	printf '  %s  (%s; %s; %s; %s%s%s)\n' \
		"$display_path" "$registration" "$label" "$head_note" \
		"$status_note; ${cleanliness_reason:-unlocked and proven clean}" \
		"${worktree_prunable:+; prunable registration}" "$lock_note" >>"$inventory_file"
	if [ -n "$worktree_prunable" ]; then
		printf -v display_prunable '%q' "$worktree_prunable"
		local candidate_note='not a local sweep candidate'
		[ "$candidate" -eq 0 ] || candidate_note='local sweep candidate'
		printf '  %s  (%s; %s; %s%s)\n' "$display_path" "$label" \
			"$candidate_note" "$display_prunable" "$lock_note" >>"$all_prunable_worktrees"
		if [ ! -e "$worktree_path" ] && [ -z "$worktree_locked" ] && [ -z "$protection" ]; then
			return 0
		fi
		printf '  %s  (prunable registration still has a live, locked, or protected holder; repository-wide prune blocked pending explicit resolution and re-plan)\n' \
			"$display_path" >>"$prune_holds"
		[ -n "$cleanliness_reason" ] || cleanliness_reason='prunable registration still has a live directory; held'
	fi
	if [ "$candidate" -eq 1 ]; then
		if [ -n "$cleanliness_reason" ]; then
			printf '  %s  (%s; blocks local deletion; not removable: %s%s)\n' \
				"$display_path" "$label" "$cleanliness_reason" "$lock_note" >>"$blocking_worktrees"
			printf '%s\t%s\n' "$worktree_branch" \
				"candidate worktree is not removable: $cleanliness_reason" >>"$blocked_candidate_reasons"
		else
			printf '%s\t%s\t%s\n' "$worktree_branch" "$display_path" "$worktree_head" >>"$clean_worktree_records"
		fi
	elif [ -z "$worktree_branch" ] && [ -n "$tip_evidence" ] && [ -z "$cleanliness_reason" ]; then
		printf '<detached>\t%s\t%s\n' "$display_path" "$worktree_head" >>"$clean_worktree_records"
	else
		printf '  %s  (%s; not held by a local sweep candidate)\n' \
			"$display_path" "$label" >>"$retained_worktrees"
	fi
}

flush_worktree() {
	[ -n "$worktree_path" ] || return 0
	if ! valid_object "$worktree_head"; then
		worktree_complete=0
		worktree_error='registered worktree HEAD missing or invalid'
		worktree_head=''
	fi
	registered_count=$((registered_count + 1))
	if [ "$registered_count" -eq 1 ]; then
		primary_root="$worktree_path"
	fi
	if [ -d "$worktree_path" ] && [ ! -L "$worktree_path" ]; then
		(cd -- "$worktree_path" && pwd -P) >"$path_attempt" || transform_failed 'worktree path resolution failed'
		read_path_output || transform_failed 'worktree path resolution returned no path'
		worktree_path="$path_value"
		[ "$registered_count" -ne 1 ] || primary_root="$worktree_path"
	fi
	printf '%s\0' "$worktree_path" >>"$registered_paths"
	inspect_worktree registered
	worktree_path=''
	worktree_branch=''
	worktree_head=''
	worktree_prunable=''
	worktree_locked=''
}

# inspect every registered record, not only candidate-held branches
if git worktree list --porcelain -z >"$worktree_records" 2>"$worktree_error_file"; then
	worktree_complete=1
else
	IFS= read -r worktree_error <"$worktree_error_file" || true
	: >"$worktree_records"
fi
field=''
while IFS= read -r -d '' field; do
	case "$field" in
	'') flush_worktree ;;
	worktree\ *) worktree_path="${field#worktree }" ;;
	HEAD\ *) worktree_head="${field#HEAD }" ;;
	branch\ refs/heads/*) worktree_branch="${field#branch refs/heads/}" ;;
	prunable) worktree_prunable='no reason supplied' ;;
	prunable\ *) worktree_prunable="${field#prunable }" ;;
	locked) worktree_locked='no reason supplied' ;;
	locked\ *) worktree_locked="${field#locked }" ;;
	esac
done <"$worktree_records"
if [ -n "$field" ] || [ -n "$worktree_path" ]; then
	worktree_complete=0
	worktree_error='truncated NUL-delimited worktree inventory'
fi
flush_worktree
if [ "$registered_count" -eq 0 ]; then
	worktree_complete=0
	[ -n "$worktree_error" ] || worktree_error='no registered worktree records returned'
fi

hold_discovered_directory() {
	local display=''
	printf -v display '%q' "$1"
	printf '  %s  (%s; directory held; never delete by name)\n' "$display" "$2" >>"$discovered_inventory"
}

inspect_discovered_directory() {
	local path="$1"
	local linked_gitdir=''
	local discovered_common=''
	local branch_status=0
	if [ -L "$path" ]; then
		hold_discovered_directory "$path" 'directory symlink skipped'
		return 0
	fi
	[ -d "$path" ] || return 0
	(cd -- "$path" && pwd -P) >"$path_attempt" || transform_failed 'discovered path resolution failed'
	read_path_output || transform_failed 'discovered path resolution returned no path'
	path="$path_value"
	if path_in_file "$path" "$registered_paths" || path_in_file "$path" "$visited_paths"; then
		return 0
	fi
	printf '%s\0' "$path" >>"$visited_paths"
	scan_directory_count=$((scan_directory_count + 1))
	# rev-parse alone would inherit an ancestor repository for an ordinary directory
	if [ ! -e "$path/.git" ] || [ -L "$path/.git" ]; then
		hold_discovered_directory "$path" 'no actual .git metadata, or metadata is symlinked'
		return 0
	fi
	if ! git -C "$path" rev-parse --path-format=absolute --show-toplevel >"$path_attempt" 2>/dev/null || ! read_path_output; then
		hold_discovered_directory "$path" 'ambiguous or invalid Git metadata'
		scan_complete=0
		return 0
	fi
	if [ "$path_value" != "$path" ]; then
		hold_discovered_directory "$path" 'Git toplevel does not match this directory'
		return 0
	fi
	if git -C "$path" rev-parse --path-format=absolute --git-common-dir >"$path_attempt" 2>/dev/null && read_path_output; then
		if (cd -- "$path_value" && pwd -P) >"$path_attempt" && read_path_output; then
			discovered_common="$path_value"
		fi
	fi
	if [ -z "$discovered_common" ]; then
		hold_discovered_directory "$path" 'common-directory query failed'
		scan_complete=0
		return 0
	elif [ "$discovered_common" != "$common_dir" ]; then
		hold_discovered_directory "$path" 'unrelated repository or unconfirmed common directory'
		return 0
	fi
	if git -C "$path" rev-parse --absolute-git-dir >"$path_attempt" 2>/dev/null && read_path_output; then
		if (cd -- "$path_value" && pwd -P) >"$path_attempt" && read_path_output; then
			linked_gitdir="$path_value"
		fi
	fi
	if [ ! -f "$path/.git" ] || [[ "$linked_gitdir" != "$common_dir"/worktrees/* ]]; then
		hold_discovered_directory "$path" 'same common directory but linked-worktree metadata is unconfirmed'
		scan_complete=0
		return 0
	fi
	worktree_path="$path"
	worktree_branch=''
	worktree_head=''
	worktree_locked=''
	worktree_prunable=''
	if worktree_branch="$(git -C "$path" symbolic-ref -q HEAD 2>/dev/null)"; then
		case "$worktree_branch" in
		refs/heads/*) worktree_branch="${worktree_branch#refs/heads/}" ;;
		*)
			hold_discovered_directory "$path" 'unexpected linked-worktree HEAD binding'
			scan_complete=0
			return 0
			;;
		esac
	else
		branch_status=$?
		if [ "$branch_status" -ne 1 ]; then
			hold_discovered_directory "$path" 'linked-worktree branch query failed'
			scan_complete=0
			return 0
		fi
	fi
	if ! worktree_head="$(git -C "$path" rev-parse --verify HEAD 2>/dev/null)" || ! valid_object "$worktree_head"; then
		hold_discovered_directory "$path" 'linked-worktree HEAD unavailable'
		scan_complete=0
		return 0
	fi
	unregistered_count=$((unregistered_count + 1))
	local display_holder=''
	local display_metadata=''
	printf -v display_holder '%q' "$path"
	printf -v display_metadata '%q' "$linked_gitdir"
	printf '  %s  (uses linked metadata %s; pruning its old registration can delete held index/gitdir data; repository-wide prune blocked pending explicit registration resolution and re-plan)\n' \
		"$display_holder" "$display_metadata" >>"$prune_holds"
	inspect_worktree unregistered
}

scan_directory() {
	local scan_root="$1"
	local mode="$2"
	local candidate_path=''
	while [[ "$scan_root" == */ && "$scan_root" != / ]]; do
		scan_root="${scan_root%/}"
	done
	if [ -L "$scan_root" ]; then
		hold_discovered_directory "$scan_root" 'scan-root symlink skipped'
		[ "$mode" != explicit ] || scan_complete=0
		return 0
	fi
	if [ ! -d "$scan_root" ]; then
		if [ "$mode" = explicit ]; then
			hold_discovered_directory "$scan_root" 'explicit scan root missing or not a directory'
			scan_complete=0
		fi
		return 0
	fi
	scan_root_total=$((scan_root_total + 1))
	if ! find "$scan_root" -mindepth 1 -maxdepth 1 -print0 >"$scan_attempt" 2>/dev/null; then
		hold_discovered_directory "$scan_root" 'bounded directory discovery failed; partial listing discarded'
		scan_complete=0
		return 0
	fi
	while IFS= read -r -d '' candidate_path; do
		if [ "$mode" = siblings ]; then
			case "${candidate_path##*/}" in "$primary_name"*) ;; *) continue ;; esac
		fi
		inspect_discovered_directory "$candidate_path"
	done <"$scan_attempt"
}

if [ -n "$primary_root" ]; then
	primary_name="${primary_root##*/}"
	scan_directory "$primary_root/worktrees" default
	scan_directory "$primary_root/.worktrees" default
	scan_directory "${primary_root%/*}" siblings
else
	scan_complete=0
fi
scan_index=0
while [ "$scan_index" -lt "$scan_root_count" ]; do
	scan_directory "${scan_roots[$scan_index]}" explicit
	scan_index=$((scan_index + 1))
done

blocked_candidate_exists() {
	local match=''
	match="$(awk -F '\t' -v branch="$1" '$1 == branch { print "found"; exit }' "$blocked_candidate_reasons_sorted")" \
		|| transform_failed 'blocked-candidate lookup failed'
	[ "$match" = 'found' ]
}

# any incomplete holder discovery suppresses all local CAS and worktree removals
if [ "$worktree_complete" -eq 0 ] || [ "$scan_complete" -eq 0 ]; then
	discovery_reason='directory discovery incomplete; local deletion suppressed'
	[ "$worktree_complete" -eq 1 ] || discovery_reason='worktree discovery incomplete; local deletion suppressed'
	printf '  %s\n' 'holder discovery incomplete; metadata dependencies unresolved; repository-wide prune blocked until discovery succeeds and the plan is rerun' >>"$prune_holds"
	while IFS= read -r blocked_branch; do
		[ -n "$blocked_branch" ] || continue
		printf '%s\t%s\n' "$blocked_branch" "$discovery_reason" >>"$blocked_candidate_reasons"
	done <"$local_candidate_names_sorted"
fi
LC_ALL=C sort -t $'\t' -k1,1 -u "$blocked_candidate_reasons" >"$blocked_candidate_reasons_sorted"
while IFS=$'\t' read -r clean_branch clean_path clean_head; do
	[ -n "$clean_branch" ] || continue
	if [ "$worktree_complete" -eq 0 ] || [ "$scan_complete" -eq 0 ] || blocked_candidate_exists "$clean_branch"; then
		printf '  %s  (%s; blocks local deletion; not removable: another worktree for this branch is not removable)\n' \
			"$clean_path" "$clean_branch" >>"$blocking_worktrees"
	elif [ "$clean_branch" = '<detached>' ]; then
		printf '  %s  (<detached>; OID %s; landed tip; unlocked and proven clean; removable only after approval)\n' \
			"$clean_path" "$clean_head" >>"$removable_worktrees"
	else
		printf '  %s  (%s; unlocked and proven clean; removable only after approval)\n' \
			"$clean_path" "$clean_branch" >>"$removable_worktrees"
	fi
done <"$clean_worktree_records"
cp "$local_candidates" "$local_candidates_filtered"
while IFS=$'\t' read -r blocked_branch blocked_reason; do
	[ -n "$blocked_branch" ] || continue
	awk -v prefix="  $blocked_branch  (" 'index($0, prefix) != 1' "$local_candidates_filtered" >"$local_attempt"
	mv "$local_attempt" "$local_candidates_filtered"
	printf '  %s  (%s)\n' "$blocked_branch" "$blocked_reason" >>"$local_skips"
done <"$blocked_candidate_reasons_sorted"
mv "$local_candidates_filtered" "$local_candidates"

LC_ALL=C sort -u "$all_tips" >"$local_attempt"
awk -F '\t' '
	function flush() {
		if (count > 1) printf "  OID %s  (%d tips; signal only, not deletion authority): %s\n", oid, count, labels
	}
	$1 != oid { flush(); oid = $1; count = 0; labels = "" }
	{ count++; labels = labels (count > 1 ? ", " : "") $2 }
	END { flush() }
' "$local_attempt" >"$duplicate_tips"

print_section() {
	printf '=== %s ===\n' "$1"
	if [ -s "$2" ]; then
		cat "$2"
	else
		printf '%s\n' '  (none)'
	fi
	printf '\n'
}

count_lines() {
	wc -l <"$1" | tr -d ' '
}

# rendering stays private until every inventory and filtering transform succeeds
merged_count="$(count_lines "$merged_branches")"
local_count="$(count_lines "$local_branches")"
remote_count="$(count_lines "$remote_branches")"
tracking_count="$(count_lines "$tracking_refs")"
duplicate_count="$(count_lines "$duplicate_tips")"
for count in "$merged_count" "$local_count" "$remote_count" "$tracking_count" "$duplicate_count"; do
	[[ "$count" =~ ^[0-9]+$ ]] || transform_failed 'invalid inventory count'
done
{
	printf 'default branch : %s\n' "$default"
	printf 'current branch : %s\n' "${current:-<detached>}"
	printf 'live default OID: %s\n' "${fallback_target:-unavailable}"
	printf '\n=== DISCOVERY COMPLETENESS ===\n'
	printf '%s\n' '  local refs      : complete (local for-each-ref)'
	printf '%s\n' '  tracking refs   : complete (all refs/remotes; other remotes inventory only)'
	printf '  default branch  : %s\n' "$default_source"
	if [ "$origin_github_bound" -eq 1 ]; then
		printf '  origin binding  : complete (%s/%s/%s; %s; exact push target %s)\n' \
			"$origin_host" "$origin_owner" "$origin_repo" "$origin_github_proof" "$origin_push_url_display"
	elif [ "$origin_identity_resolved" -eq 1 ]; then
		printf '  origin binding  : incomplete (%s/%s/%s resolved, but GitHub API binding unconfirmed)\n' \
			"$origin_host" "$origin_owner" "$origin_repo"
	else
		printf '  origin binding  : incomplete (%s)\n' "$origin_identity_error"
	fi
	if [ "$remote_complete" -eq 1 ]; then
		printf '%s\n' '  remote heads    : complete (live exact push target via git ls-remote --heads)'
	else
		printf '  remote heads    : incomplete (exact push-target query failed: %s)\n' "${remote_error:-unknown error}"
	fi
	if [ "$worktree_complete" -eq 1 ]; then
		printf '%s\n' '  worktree records: complete (local git worktree list --porcelain -z)'
	else
		printf '  worktree records: incomplete (local query failed: %s)\n' "${worktree_error:-unknown error}"
	fi
	if [ "$scan_complete" -eq 1 ]; then
		printf '  directory scan  : complete within %s bounded roots; direct children only; directory symlinks skipped\n' "$scan_root_total"
	else
		printf '%s\n' '  directory scan  : incomplete; all local deletion and worktree removal suppressed'
	fi
	if [ -s "$prune_holds" ]; then
		printf '%s\n' '  worktree prune  : blocked (see WORKTREE PRUNE HOLDS; prunable records are inventory only)'
	else
		printf '%s\n' '  worktree prune  : requires fresh complete-set approval; no observed holder dependency blocks'
	fi
	if [ "$github_complete" -eq 1 ]; then
		printf '  merged PR heads : complete (%s unique ref+SHA records from all gh api --paginate pages)\n' "$merged_count"
	else
		printf '  merged PR heads : incomplete (%s; any partial GitHub output was discarded)\n' "${github_error:-GitHub query failed}"
	fi
	if [ "$fallback_complete" -eq 1 ]; then
		printf '  live ancestry   : available against exact live default OID %s; checked independently of PR matches\n' "$fallback_target"
		if [ "$github_complete" -eq 0 ]; then
			printf '  local fallback  : complete commit-ancestry query against live default OID %s; best-effort for squash/rebase merges\n' "$fallback_target"
		fi
	else
		printf '  live ancestry   : unavailable (%s)\n' "$fallback_error"
		if [ "$github_complete" -eq 0 ] && [ "$default_confirmed" -eq 0 ]; then
			printf '%s\n' '  local fallback  : suppressed (default branch unconfirmed; rerun with --default <branch>)'
		fi
	fi
	printf '\n=== INVENTORY COUNTS ===\n'
	printf '  local heads %s; live origin heads %s; remote-tracking refs %s\n' \
		"$local_count" "$remote_count" "$tracking_count"
	printf '  registered worktrees %s; unregistered linked worktrees %s; extra directories inspected %s\n' \
		"$registered_count" "$unregistered_count" "$scan_directory_count"
	printf '  duplicate-tip groups %s; conditional ignored outputs %s\n\n' "$duplicate_count" "$conditional_output_count"
	print_section 'LOCAL HEAD INVENTORY' "$local_inventory"
	print_section 'LIVE ORIGIN HEAD INVENTORY' "$remote_inventory"
	print_section 'REMOTE-TRACKING REF INVENTORY' "$tracking_inventory"
	print_section 'REGISTERED WORKTREE INVENTORY' "$registered_inventory"
	print_section 'DUPLICATE TIP GROUPS' "$duplicate_tips"
	print_section 'LOCAL CANDIDATES (merged branches to sweep)' "$local_candidates"
	print_section 'REMOTE CANDIDATES (live origin heads to sweep)' "$remote_candidates"
	print_section 'ORIGIN TRACKING CLEANUP CANDIDATES' "$tracking_candidates"
	print_section 'CONDITIONAL ORIGIN TRACKING CLEANUP' "$conditional_tracking"
	print_section 'LOCAL SKIPS' "$local_skips"
	print_section 'REMOTE SKIPS' "$remote_skips"
	print_section 'WORKTREES REMOVABLE AFTER APPROVAL' "$removable_worktrees"
	print_section 'WORKTREES BLOCKING LOCAL SWEEP CANDIDATES' "$blocking_worktrees"
	print_section 'WORKTREE PRUNE HOLDS' "$prune_holds"
	print_section 'ALL PRUNABLE WORKTREE RECORDS' "$all_prunable_worktrees"
	print_section 'WORKTREES RETAINED' "$retained_worktrees"
	print_section 'DISCOVERED DIRECTORIES HELD' "$discovered_inventory"
	print_section 'CONDITIONAL IGNORED-OUTPUT CLEANUP' "$conditional_outputs"
	printf '%s\n' 'note: paths are reversible shell-escaped tokens. Age, names, duplicate tips and origin-gone are signals only. Unknown content, configs, databases and submodules remain held; conditional outputs are not proven clean. This script changes no refs or worktrees; exact-tip deletion, output removal and pruning require approval.'
} >"$plan_output"
cat "$plan_output"
