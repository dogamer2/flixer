# Flixer Discord Status Worker

Standalone Cloudflare Worker for syncing the Discord status message every 10 minutes.

## Required secrets

- `DISCORD_BOT_TOKEN`

## Optional secrets/vars

- `DISCORD_STATUS_URL`
- `DISCORD_STATUS_CHANNEL_ID`
- `DISCORD_STATUS_MESSAGE_ID`
- `DISCORD_STATUS_ROLE_ID`
- `DISCORD_STATUS_SITE_LABEL`

Defaults:

- status URL: `https://flixercc.pages.dev/api/status`
- channel ID: `1485492554374975538`
- message ID: `1485547180570837003`
- status role ID: `1485575817718403072`
- site label: `Flixer`

## Deploy

From this folder:

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler deploy
```

Optional manual test:

```bash
curl -X POST https://<your-worker>.workers.dev/run
```

Health check:

```bash
curl https://<your-worker>.workers.dev/healthz
```
