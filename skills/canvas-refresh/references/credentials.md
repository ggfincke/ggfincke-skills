# Saved sign-in credentials

The persistent browser session remains the first choice. A saved password does not replace second-factor approval.

When the user asks to provide or save a password, call 456code's `request_secret` with `delivery: "file"`. Its private card is a temporary handoff, not durable password storage. Never ask for a password in chat.

For durable storage on a Linux host, use the existing unlocked Secret Service through `secret-tool`. The Canvas credential is found by the lookup attributes recorded under `credentials` in the machine-local configuration (an `application` and an `account` value). That configuration records only this lookup metadata. Do not store the password in course folders, run receipts, skill source, or config JSON.

Transfer the private delivery file into `secret-tool store` through process stdin without putting its contents into command arguments or output. Verify retrieval by comparing bytes inside the process and reporting only success/failure, then remove the consumed delivery file. Refuse an unexpectedly different pre-existing credential instead of silently replacing it. On failure, preserve the temporary input for retry and do not claim the password was saved.

Read the configured lookup only inside a process that forwards it directly to a supported private credential consumer. Never run a bare `secret-tool lookup` that prints its value into tool results. Use the existing user session bus if the agent environment omits `DBUS_SESSION_BUS_ADDRESS`; do not start a replacement keyring or change its lock settings.

The current `preview_act` accepts literal `text` and does not accept `secretRef` or a private file. Do not paste a retrieved password into a tool call or improvise a server to expose it to the page. Until the browser offers a supported private fill path, have the user enter/autofill the password in the Browser panel. Keep the keyring entry for later supported consumers. A stored credential alone is not proof of automatic sign-in.
