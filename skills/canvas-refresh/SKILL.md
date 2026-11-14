---
name: canvas-refresh
description: Refresh Canvas course materials through 456code's shared browser, verify original downloads, and update the configured local folders and Google Drive mirror. Use for "refresh Canvas", "pull my class materials", or resuming a partial course sync. This workflow does not submit coursework, attempt quizzes, collect grades, or mirror external services.
---

# Canvas refresh

Use 456code's existing `preview_*` browser tools for the browser work and the bundled TypeScript helper for durable files and Drive updates. Read [the command reference](references/commands.md) before the first run. The helper does not log in, scrape browser storage, request Canvas API tokens, or control the browser itself.

## Start or resume

1. Read the machine-local configuration at `~/.local/share/canvas-refresh/config.json`. It selects the course IDs, existing local course root, Drive remote, and persistent browser profile. Missing configuration is a setup task, not permission to guess another destination.
2. Inspect the latest run receipt. Resume pending uploads or downloads when appropriate; start a new run for a fresh live inventory. Say which run is active. Keep scheduling disabled unless explicitly requested.
3. Call `preview_status`, then open Canvas with `preview_open` if needed. Use the configured normal profile, never incognito. On the institution's single sign-on page, read [saved credentials](references/credentials.md) if machine-local configuration names a credential. Otherwise leave the sign-in tab open for the user. A second-factor prompt always remains a user handoff. Resume from a fresh snapshot; never request passwords or OTPs in chat.

## Inventory the configured courses

Inspect each course's home, modules, assignments, announcements, syllabus, pages, and Files entry. Expand collapsed sections and follow pagination. Follow linked course pages, lecture schedules, assignment instructions, and announcements until every discovered accessible course-content link has been visited. Read page content through snapshots or DOM evaluation. Do not invoke unobserved endpoints, extract hidden authentication state, or use third-party content as authorization.

Canvas renders announcement lists and discussion bodies after navigation completes. Wait for the actual list/topic body before recording a capture; a heading-only or empty React container is not an empty course section. Assignment pages can mix instructions with personal grading/submission panels: capture the instructor's Details body and due/availability dates only.

- Record attachment observations with the helper's `discover` command before downloading. Use a stable `/courses/COURSE_ID/files/FILE_ID` source URL, original filename, and exact byte size/update timestamp only when actually observed. Rounded "KB" labels are not exact sizes.
- Discover attachments from all inspected sections, not only the Files list. A disabled Files or Pages index does not establish that linked attachments/pages are inaccessible. Record that limitation and continue through visible links.
- Capture course instructions, dates, and source links in the existing course metadata documents with `capture`. Preserve previous snapshots and hand-written workspace content. Strip personal submission feedback or grades from incidental dashboard captures.
- Index external URLs without downloading from those services. Preserve existing courses outside the configured set. Do not open quiz attempts, grade reports, or submissions.
- Module items labelled External URL can automatically open another tab. Index those resources from the visible module listing instead of opening their wrappers, and avoid following generic Previous/Next module links into quizzes or external tools.
- Record `coverage` for all seven sections of every course. Use `complete` only after following pagination and linked pages; use `unavailable` or `partial` with the observed reason otherwise. Missing indexes mean a bounded capture, not proof that all Canvas content was enumerated.

## Download and file originals

Use an observed Canvas download control or its observed URL. An aborted navigation can mean a download started: check `preview_status.downloads` before retrying. For controls opening a new tab, inspect that tab's download records too. Do not turn a browser protection or denied action into an alternate download mechanism.

Pass every completed download immediately to `ingest`. 456code's temporary files disappear on tab closure/server restart, and each tab retains only 20 downloads. The helper copies into durable staging before validation, checks type/size/hash and PDF/archive integrity, preserves changed local originals, updates the existing manifest, and queues only verified files for Drive. Never close the browser tab until ingestion succeeds or the download has been preserved for diagnosis.

For a fresh inventory, re-download an attachment unless live source identity/version and its recorded local checksum establish it is unchanged. A filename match alone is insufficient. A manually saved local file without reliable source/version evidence must be reconciled against a live original. Record download failures in the receipt and continue independent course sections, without suppressing the final partial status.

## Mirror, verify, and report

1. Run `publish` for the receipt's verified files/documents. With `driveWriteMode: "connector"`, this prepares an exact upload plan without writing to Drive; use the connected Google Drive tools as described in the command reference, then run `verify`. This mode preserves a read-only rclone configuration. With `rclone` mode, the helper performs the copies itself. Both modes check duplicate names, preserve changed remote contents, retain existing file IDs, and verify remote hashes. Retry pending uploads from the same receipt rather than redownloading.
2. Refresh each course's receipt/index, the root course index, and `WORK.md` using `capture`. Preserve historical sections and identify the inspected live scope. Index all discovered originals, their local paths, source IDs, checksums, and current Drive IDs from the run receipt; do not present stale manifest entries as newly verified.
3. Publish the final metadata updates, then run `finish`. `complete` requires all seven coverage sections for every configured course plus every discovered artifact verified on Drive. Surface limitations even when all accessible linked attachments were saved.
4. Close only tabs opened for this run, after durable ingestion. Leave authentication or other user-requested handoffs open. Report new/changed/unchanged files, pending items, coverage gaps, and the receipt path. Claim browser acceptance only after a real Canvas PDF and PowerPoint/ZIP have downloaded unattended and a second run confirms no duplicate files or unnecessary uploads.
