# Canvas file helper

Requires Node 24+, `rclone`, `pdfinfo`, `unzip`, and `file`. Run the bundled `scripts/canvas-files.ts` with Node. No npm dependencies or additional browser service are required.

The default state directory is `~/.local/share/canvas-refresh`; `CANVAS_REFRESH_HOME` overrides it for isolated fixtures. The configuration is machine-local and contains no credentials:

    {
      "root": "/absolute/existing/course/workspace",
      "remote": "gdrive:existing/course/mirror",
      "baseUrl": "https://canvas.example.edu",
      "profileId": "default",
      "driveWriteMode": "connector",
      "connectorUploadLimitBytes": 104857600,
      "courses": { "CS1234": { "id": 123456 } }
    }

Commands print JSON. All mutations to one state directory serialize through an owner-recorded lock. If a process crashes, inspect `.lock/owner.json` and verify that exact process has exited before moving the stale lock into that run's recovery folder. Do not remove an active lock. The helper retains `runs/RUN_ID/receipt.json`, staged downloads/documents, and local recovery copies.

## Commands

    node /absolute/skill/scripts/canvas-files.ts start
    node /absolute/skill/scripts/canvas-files.ts status RUN_ID

`start` reads configuration, creates a receipt, and prints its run ID and destination configuration. `status` reads an existing receipt without changing it.

The following commands take JSON on stdin. Write large browser observations to a task-owned input file and redirect it into the helper; never interpolate page text into shell commands.

    node /absolute/skill/scripts/canvas-files.ts discover RUN_ID < observations.json

Input is an array of attachment observations: `course`, numeric `fileId`, observed `filename`, stable Canvas `source`, optional exact `expectedBytes`, and optional `updatedAt`. An observation is not a downloaded file. Repeating discovery preserves its current receipt state.

    node /absolute/skill/scripts/canvas-files.ts ingest RUN_ID < attachment.json

Input is one observation plus `downloadPath` from a completed `preview_status.downloads` record. The download is durably staged, validated, atomically installed, and entered in the existing course `Canvas/file-manifest.json`. Unknown manifest fields and older versions remain intact. Conflicting file IDs use a `.canvas-FILE_ID` filename rather than silently replacing another source's path. Reingestion of identical content does not replace the original file.

    node /absolute/skill/scripts/canvas-files.ts capture RUN_ID < document.json

Input is `{ "relativePath": "CS1234/Canvas/announcements.md", "content": "UTF-8 text" }`. Allowed destinations are configured courses' `Canvas/` metadata (`.md`, `.json`, `.ics`), plus root `WORK.md` and `Canvas Courses.md`. Attachment directories, traversal, and symlinks leaving the workspace are refused. Supply the full resulting document, preserving historical or hand-written sections before replacement.

    node /absolute/skill/scripts/canvas-files.ts coverage RUN_ID < coverage.json

Input has `course`, `section`, `status`, stable `source`, and optional `note`. Sections are `home`, `modules`, `assignments`, `announcements`, `syllabus`, `pages`, and `files`. Status is `complete`, `unavailable`, `needs-login`, or `partial`. Updating a section replaces only that section's coverage record.

    node /absolute/skill/scripts/canvas-files.ts publish RUN_ID
    node /absolute/skill/scripts/canvas-files.ts finish RUN_ID

`publish` checks each recorded local hash, lists the exact destination, refuses duplicate names/native Google documents, copies differing remote content into `.canvas-recovery/RUN_ID/`, and then uses `rclone copyto --checksum` to update it. Readback checks the remote hash/size and preserves an existing file's ID. Failures remain in the receipt for retry; successful local files are kept. A zero exit code for `publish` means the pass finished: inspect `pending` and counts for per-file failures.

`finish` records `complete` only when all configured course sections are complete and all discovered artifacts have verified uploads; otherwise it records `partial`. The receipt is the resumable source of truth. It does not infer inaccessible content, silently mark a failure successful, or schedule another run.

## Connected Drive writes

Use `driveWriteMode: "connector"` when the rclone remote is read-only and the connected Google Drive tool can write to the same verified folder/account. Keep that existing read-only remote intact. In this mode, `publish` writes `upload-plan.json` and returns `uploads`; it performs no Drive mutations. It marks remote-identical artifacts verified immediately.

For each pending descriptor:

1. Resolve its exact parent folder ID through the read-only rclone listing or connected Drive metadata. Create only a missing target subfolder under the verified course mirror. Refuse ambiguous duplicate folder names.
2. If `needsBackup` is true, copy `existingId` with Drive `copy_file` into the configured mirror's `.canvas-recovery/RUN_ID/` folder. Give it a unique name derived from `relativePath` plus the previous checksum; reuse an already matching recovery copy on retry. Record its full rclone path with `backup` before replacing the original:

       node /absolute/skill/scripts/canvas-files.ts backup RUN_ID < backup.json

   Input is `{ "key": "CS1234:123", "driveBackup": "gdrive:existing/course/mirror/.canvas-recovery/RUN_ID/unique-name" }`. This checks the copy's old size/hash and confirms the original still matches the observed before-state. A rejected backup blocks that replacement.
3. Call Drive `update_file` with `fileId: existingId` and `file_uri: localPath` for an existing raw file. For a new file, use `upload_file` with that local path, the exact destination filename, and `parent_folder_id`. Preserve sharing and native Google documents.
4. Run `verify RUN_ID` to read back all receipt artifacts through rclone and check their hashes, sizes, and existing IDs. Replacements are not marked verified without their recorded recovery copy. A crash after upload is reconciled by the next `publish`/`verify`, avoiding a duplicate upload.

The helper cannot call conversation-bound connector tools itself. The skill owns that orchestration. Verify the connector's account and destination metadata before the first write; do not silently reauthorize rclone or widen its scope when connector writes are unavailable.

A separately authorized uploader can use `driveWriteMode: "rclone"` with `writeRemote: "canvas-write:"` while keeping `remote` set to the existing read-only mirror. The writer must be verified to point to that exact same folder before enabling it. Uploads and recovery copies use the writer; listings and checksum/ID readback continue through the read-only remote. This supports large originals without transferring them through the connector or browser file bridge. Setting up that writer requires the user's separate Google authorization; never widen the read-only remote's scope implicitly.

If a file exceeds the configured connector upload limit, the plan marks `browserUploadRequired`. Use the same shared browser to open its verified Drive parent folder, allow the user to sign in if necessary, and upload the original file with `preview_act`'s file chooser support. Inspect the folder first for an existing copy; do not create duplicates after an uncertain upload. Wait for completion and run the same checksum/ID readback through `verify`. Preserve an existing file's version/ID when replacing it. Keep an original pending if neither connector nor browser upload is available; do not split or recompress it to change its identity.
