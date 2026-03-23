import { forwardToUpstream, getTargetApiUrl } from "./proxy.js";

const DEFAULT_STATUS_CHANNEL_ID = "1485492554374975538";
const DEFAULT_SITE_LABEL = "flixercc.pages.dev";
const DISCORD_API_BASE = "https://discord.com/api/v10";
const ACTIVE_LABEL = "Active";
const OFFLINE_LABEL = "Offline";
const STATUS_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const STATUS_CHECK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const STATUS_SYNC_STATE_KEY = "__FLIXER_DISCORD_STATUS_SYNC_STATE__";

function getSyncState() {
  const existing = globalThis[STATUS_SYNC_STATE_KEY];

  if (existing && typeof existing === "object") {
    return existing;
  }

  const initialState = {
    inFlight: null,
    lastAttemptAt: 0,
  };

  globalThis[STATUS_SYNC_STATE_KEY] = initialState;
  return initialState;
}

function getStatusConfig(env) {
  const botToken = String(env?.DISCORD_BOT_TOKEN || env?.DISCORD_TOKEN || "").trim();

  if (!botToken) {
    return null;
  }

  return {
    botToken,
    channelId: String(env?.DISCORD_STATUS_CHANNEL_ID || DEFAULT_STATUS_CHANNEL_ID).trim(),
    siteLabel: String(env?.DISCORD_STATUS_SITE_LABEL || DEFAULT_SITE_LABEL).trim(),
  };
}

function buildStatusDescription(siteLabel, isActive) {
  return `${siteLabel} — ${isActive ? `${ACTIVE_LABEL} ✅` : `${OFFLINE_LABEL} ❌`}`;
}

function buildStatusMessage(siteLabel, isActive) {
  return [
    "**STATUS UPDATE**",
    `**${siteLabel}** — *${isActive ? ACTIVE_LABEL : OFFLINE_LABEL}* ${isActive ? "✅" : "❌"}`,
  ].join("\n");
}

async function discordRequest(path, token, init = {}) {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorBody}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function probeSiteStatus(request) {
  const upstreamUrl = getTargetApiUrl("/api/time", "");

  try {
    const upstreamResponse = await forwardToUpstream(request, upstreamUrl, {
      hostType: "target",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "sec-ch-ua": '"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "user-agent": STATUS_CHECK_USER_AGENT,
      },
    });

    return upstreamResponse.ok;
  } catch {
    return false;
  }
}

async function syncDiscordStatus(env, request) {
  const config = getStatusConfig(env);

  if (!config) {
    return;
  }

  const isActive = await probeSiteStatus(request);
  const desiredDescription = buildStatusDescription(config.siteLabel, isActive);
  const application = await discordRequest("/applications/@me", config.botToken, {
    method: "GET",
  });
  const currentDescription = String(application?.description || "").trim();

  if (currentDescription === desiredDescription) {
    return;
  }

  await discordRequest("/applications/@me", config.botToken, {
    method: "PATCH",
    body: JSON.stringify({
      description: desiredDescription,
    }),
  });

  await discordRequest(`/channels/${config.channelId}/messages`, config.botToken, {
    method: "POST",
    body: JSON.stringify({
      content: buildStatusMessage(config.siteLabel, isActive),
    }),
  });
}

export function maybeSyncDiscordStatus(env, request) {
  const config = getStatusConfig(env);

  if (!config) {
    return null;
  }

  const state = getSyncState();
  const now = Date.now();

  if (state.inFlight) {
    return state.inFlight;
  }

  if (now - state.lastAttemptAt < STATUS_SYNC_INTERVAL_MS) {
    return null;
  }

  state.lastAttemptAt = now;
  state.inFlight = syncDiscordStatus(env, request)
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    })
    .finally(() => {
      state.inFlight = null;
    });

  return state.inFlight;
}
