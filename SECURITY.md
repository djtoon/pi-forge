# Security

## What pi-Forge agents can do

Harnesses are coding agents. They run on your machine **with your user's permissions**: they read and write files, run shell commands, and call the network through their tools. Treat a harness like any script you run:

- Run harnesses in a folder you're comfortable letting them change.
- Review tools that pi-Forge wrote for you (`custom/extensions/`) before you trust them with anything important.
- Only run harnesses, skills and views from people you trust. Extensions are code.
- Use `guards:` in `harness.yaml`:
  - `protected_paths` covers files that `write` or `edit` must not touch without your OK.
  - `confirm_bash` covers command fragments that need your OK.

  With no one to ask (headless modes), a guarded call is blocked.

## The web UI

- It listens on `127.0.0.1` only.
- Each run creates a random token. API calls without it are refused, and requests with an unexpected `Host` header are rejected (DNS-rebinding protection).
- Logos are served with a strict Content-Security-Policy.

Don't expose the port to other machines (for example with a tunnel or a reverse proxy). Anyone who can reach the page can control the agent.

## Provider keys

- Keys entered in **Settings** go in `~/.forge/credentials.json`, written with owner-only permissions where the OS supports it. They're set as environment variables when a harness starts.
- They're only sent to your model provider.
- The browser only ever receives masked previews (for example `sk-a…9f2c`), never the full key.
- pi's own `/login` credentials stay in `~/.forge/<name>/auth.json`.

Never commit `~/.forge`, `.env` files, or keys inside `harness.yaml` or `custom/`.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Use GitHub's private reporting instead: open the repository's **Security** tab, then **Report a vulnerability**. Include steps to reproduce and the version (commit) you tested. We'll reply as soon as we can.
