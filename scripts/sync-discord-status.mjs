const DEFAULT_STATUS_URL = "https://flixercc.pages.dev/api/status";
const DEFAULT_SITE_LABEL = "flixercc.pages.dev";
const DEFAULT_STATUS_CHANNEL_ID = "1485492554374975538";
const DISCORD_API_BASE = "https://discord.com/api/v10";
const ACTIVE_LABEL = "Active";
const OFFLINE_LABEL = "Offline";

function getRequiredEnv(name, fallback = "") {
  const value = String(process.env[name] || fallback).trim();

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function getStatusConfig() {
  return {
    botToken: getRequiredEnv("DISCORD_BOT_TOKEN", process.env.DISCORD_TOKEN),
    channelId: getRequiredEnv("DISCORD_STATUS_CHANNEL_ID", DEFAULT_STATUS_CHANNEL_ID),
    siteLabel: getRequiredEnv("DISCORD_STATUS_SITE_LABEL", DEFAULT_SITE_LABEL),
    statusUrl: getRequiredEnv("DISCORD_STATUS_URL", DEFAULT_STATUS_URL),
  };
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);

  return {
    clear() {
      clearTimeout(timer);
    },
    signal: controller.signal,
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

async function getCurrentApplication(botToken) {
  return discordRequest("/applications/@me", botToken, {
    method: "GET",
  });
}

async function updateApplicationDescription(botToken, description) {
  return discordRequest("/applications/@me", botToken, {
    body: JSON.stringify({
      description,
    }),
    method: "PATCH",
  });
}

async function postStatusMessage(botToken, channelId, content) {
  return discordRequest(`/channels/${channelId}/messages`, botToken, {
    body: JSON.stringify({
      content,
    }),
    method: "POST",
  });
}

async function probeSiteStatus(statusUrl) {
  const timeout = withTimeout(10_000);

  try {
    const response = await fetch(statusUrl, {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
      },
      method: "GET",
      signal: timeout.signal,
    });

    const payload = await response.json().catch(() => ({}));
    const isActive = response.ok && payload && payload.status === "active";

    return {
      details: payload,
      isActive,
      responseStatus: response.status,
    };
  } catch (error) {
    return {
      details: {
        error: error instanceof Error ? error.message : "Unknown status probe failure",
        status: "offline",
      },
      isActive: false,
      responseStatus: 0,
    };
  } finally {
    timeout.clear();
  }
}

async function main() {
  const config = getStatusConfig();
  const statusProbe = await probeSiteStatus(config.statusUrl);
  const desiredDescription = buildStatusDescription(config.siteLabel, statusProbe.isActive);
  const currentApplication = await getCurrentApplication(config.botToken);
  const currentDescription = String(currentApplication?.description || "").trim();

  if (currentDescription === desiredDescription) {
    console.log(`Status unchanged: ${desiredDescription}`);
    return;
  }

  await updateApplicationDescription(config.botToken, desiredDescription);
  await postStatusMessage(
    config.botToken,
    config.channelId,
    buildStatusMessage(config.siteLabel, statusProbe.isActive),
  );

  console.log(
    `Status changed to ${statusProbe.isActive ? ACTIVE_LABEL : OFFLINE_LABEL} (${statusProbe.responseStatus || "no-response"}).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
