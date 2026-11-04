# PA-RTOS

- Keep the architecture small: OpenClaw owns inference, tools, sessions and memory; cloud provides device HTTP access.
- RTOS firmware is reserved for the hardware developer. Keep `RTOS/` empty except for `.gitkeep` until hardware work begins.
- Never commit real deployment addresses, API keys, device tokens, user memories, logs or screenshots of private accounts.
- Keep private runtime data outside this checkout. Examples use reserved example domains and synthetic credentials.
- `spec/rtos-connection.md` describes this project's implemented connection. The inherited Doudou specs are references, not shipped PA-RTOS features.
- Before deployment, inspect the selected host. Add only this project's files, account, service and ports; preserve other services and their configuration.

