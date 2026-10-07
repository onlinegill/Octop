# Discord Channel: Local Acceptance and Configuration

Supports DMs, server text channels, existing threads, text/images/attachments, typing indicators, and automatic splitting of long replies.

## 1. Install dependencies and start

The Discord adapter ships with `octop-gateway 0.9.9`. Octop requires `octop-gateway>=0.9.9`, so you can use the published package directly without cloning the adjacent gateway repo:

```sh
cd Octop
uv sync --locked --extra dev
uv run octop run
```

You can append your existing startup parameters after `uv run octop run`. First stop any old process holding the same server port; do not run two instances with the same Bot Token at the same time.

Use `bash scripts/run-discord-local.sh` only when debugging against adjacent `octop-gateway` source; that script overrides the published package with a local editable dependency. Re-run `uv sync --locked --extra dev` to restore the published package.

## 2. Where to fill things in

Open the local Octop web UI and go to **Agent → Channels → More channels → Discord**.

1. **Bot Token**: paste the Token generated on the Bot page of the Discord Developer Portal. No Public Key or Client Secret is needed.
2. **Allow all accessible channels**: on by default, so no channel IDs are required; the bot responds in every server text channel and existing thread it has Discord access to. When off, fill in **Allowed channel IDs**, separated by commas or newlines; leaving it empty means no server-channel messages are accepted. Existing threads inherit their parent channel's permissions, and you can also list thread IDs explicitly. Old configs that lack `allow_all_channels` are also treated as on; only saving it explicitly as `false` restricts to the list.
3. **Allowed DM user IDs**: enter your Discord user ID. DMs are authorized independently; an empty list means no DM messages are accepted.
4. **HTTP Proxy / HTTP Proxy Auth**: fill these in when the network requires a proxy. The auth format is `user:password`; the proxy applies to the Gateway, the API, and attachment downloads.
5. Click **Check connection**, then **Save** on success. The connection check verifies that the bot can log in to the Gateway; it does not prove that a given channel is sendable — verify that with real messages in the next section.

After enabling Developer Mode in Discord user settings, you can right-click a channel/user to copy its ID. The ID must be the full number — not the channel name, and not the Application ID.

## 3. Discord application settings

On the Bot page, enable **Message Content Intent**. Invite the bot to your test server and grant it View Channels, Send Messages, Read Message History, Attach Files, and Send Messages in Threads permissions. The first version does not need Server Members or Presence Intent.

By default, server channels only start the Agent when a user directly `@`-mentions the bot; `@everyone` and role mentions are not treated as direct triggers. Users on the DM allowlist do not need to `@`. Bot and webhook messages are ignored.

## 4. Manual acceptance (~10 minutes)

| Action | Expected |
|---|---|
| In an allowed channel, send `@bot hello`, then send a message without `@` | The first gets a reply; the second does not trigger the Agent on its own |
| Ask from two users in the same channel, then ask in another allowed channel/thread | Same channel shares context; channels and threads are isolated from each other |
| DM from an allowed user; then turn off "allow all channels" and send from an unauthorized channel | The DM gets a reply; the unauthorized channel gets none |
| Send an image/file and request a long reply | The attachment enters the existing media pipeline; the long reply is split, code blocks stay readable, and no accidental `@everyone` occurs |
| Disable/enable the channel and restart the service, then ask again | Recovers normally, with no duplicate replies; on disconnect, a reconnect hint appears once channel state is re-fetched |

Upload limits depend on the Discord server and Bot permissions; remote attachment downloads are capped at 25 MiB in the adapter, and over-limit/upload failures fall back to the existing error or attachment-degradation handling.

Not yet included: native Slash Command registration, automatic thread creation, voice channels, and edited streaming replies. For one Agent, configure one Discord Bot first; session isolation when multiple Bots of the same Agent share one channel is out of scope for the first version.

This round of automated acceptance used a mock Gateway/REST and does not require a real Token. Real network, Discord server permissions, and LLM replies are verified by the manual steps above.

## 5. Automated acceptance results (2026-09-21)

| Check | Result |
|---|---|
| octop-gateway `make all` | Format, Lint, mypy pass; 458 tests pass, 13 integration tests excluded by the default command |
| Octop `make all` | Format, Lint, mypy pass; 3587 tests pass, 17 conditionally skipped |
| Discord final relevant backend review | 18 pass, covering routing, live state, channel CRUD, and config probing |
| Frontend channel tests | 12 pass, including the Discord entry, Token, and full long-numeric-ID save flow |
| `make build-frontend` / startup script | TypeScript and Vite builds pass; `run-discord-local.sh --help` passes; the bundled web artifact is generated |

Commands use `RUN='uv run --no-sync'` to keep the unpublished local gateway; the channel library reuses Octop's dev environment (`UV_PROJECT_ENVIRONMENT=../Octop/.venv`). Octop's full test suite requires binding a random local port; the initial 15 port-permission failures caused by the sandbox were fully re-run and passed after local ports were allowed.

No real Bot Token was used, and no package was published and no code was committed or pushed. For manual testing, use the local startup method in section 1 of this document.

## 6. All-channels default-mode acceptance (2026-09-22)

Added the "allow all accessible channels" toggle, on by default in both frontend and backend; old configs missing this field are likewise treated as on. After turning it off and saving, the specified-channel mode is retained; the input box keeps the existing IDs. The DM allowlist and the direct-`@` trigger rules are unchanged.

- octop-gateway `make all`: 460 passed, 13 deselected; format, Lint, mypy pass.
- Octop `make all`: 3591 passed, 17 skipped; format, Lint, mypy pass.
- Frontend channel tests: 16 passed, covering default-on, save-after-off, old-config default value, and retaining the boolean when re-editing.
- ESLint passes for the relevant frontend files; TypeScript and Vite builds pass, and the bundled web artifact is updated.
- Takes effect after restarting local Octop and refreshing the web UI; real Discord integration is still tested manually by the user.
