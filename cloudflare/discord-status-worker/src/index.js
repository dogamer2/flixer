const DISCORD_API_BASE = "https://discord.com/api/v10";
const DEFAULT_STATUS_URL = "https://flixercc.pages.dev/api/status";
const DEFAULT_STATUS_CHANNEL_ID = "1485492554374975538";
const DEFAULT_STATUS_MESSAGE_ID = "1485547180570837003";
const DEFAULT_STATUS_ROLE_ID = "1485575817718403072";
const DEFAULT_SITE_LABEL = "Flixer";
const ACTIVE_LABEL = "Online";
const OFFLINE_LABEL = "Offline";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return jsonResponse({ ok: true, service: "discord-status-cron" });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      try {
        const result = await syncDiscordStatus(env);
        return jsonResponse({ ok: true, result });
      } catch (error) {
        return jsonResponse(
          { error: error instanceof Error ? error.message : "Status sync failed" },
          500,
        );
      }
    }

    return jsonResponse(
      {
        ok: true,
        message: "Use Cloudflare Cron Triggers or POST /run to trigger a status sync.",
      },
      200,
    );
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      syncDiscordStatus(env).catch((error) => {
        console.error(error instanceof Error ? error.message : error);
      }),
    );
  },
};

function getRequiredEnv(env, name, fallback = "") {
  const value = String(env?.[name] || fallback).trim();

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function getStatusConfig(env) {
  return {
    botToken: getRequiredEnv(env, "DISCORD_BOT_TOKEN", env?.DISCORD_TOKEN),
    channelId: getRequiredEnv(env, "DISCORD_STATUS_CHANNEL_ID", DEFAULT_STATUS_CHANNEL_ID),
    messageId: getRequiredEnv(env, "DISCORD_STATUS_MESSAGE_ID", DEFAULT_STATUS_MESSAGE_ID),
    roleId: getRequiredEnv(env, "DISCORD_STATUS_ROLE_ID", DEFAULT_STATUS_ROLE_ID),
    siteLabel: getRequiredEnv(env, "DISCORD_STATUS_SITE_LABEL", DEFAULT_SITE_LABEL),
    statusUrl: getRequiredEnv(env, "DISCORD_STATUS_URL", DEFAULT_STATUS_URL),
  };
}

function buildStatusDescription(siteLabel, isActive) {
  return `${siteLabel} — ${isActive ? `${ACTIVE_LABEL} ✅` : `${OFFLINE_LABEL} ❌`}`;
}

function buildStatusMessage(siteLabel, isActive) {
  const checkedAt = Math.floor(Date.now() / 1000);
  const icon = isActive ? "🟢" : "🔴";

  return [
    `**${siteLabel} Status**`,
    `${icon} **${isActive ? ACTIVE_LABEL : OFFLINE_LABEL}**`,
    `Last checked: <t:${checkedAt}:R>`,
  ].join("\n");
}

async function discordRequest(path, token, init = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });

    if (response.ok) {
      if (response.status === 204) {
        return null;
      }

      return response.json();
    }

    if (response.status === 429) {
      const retryPayload = await response.json().catch(() => ({}));
      const retryAfterMs = Math.max(500, Math.ceil(Number(retryPayload?.retry_after || 1) * 1000));
      await delay(retryAfterMs);
      continue;
    }

    const errorBody = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorBody}`);
  }

  throw new Error("Discord API request failed (429): exceeded retry attempts");
}

async function getCurrentApplication(botToken) {
  return discordRequest("/applications/@me", botToken, { method: "GET" });
}

async function updateApplicationDescription(botToken, description) {
  return discordRequest("/applications/@me", botToken, {
    body: JSON.stringify({ description }),
    method: "PATCH",
  });
}

async function updateStatusMessage(botToken, channelId, messageId, content, roleId, changed) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, botToken, {
    body: JSON.stringify({
      allowed_mentions: changed ? { parse: [], roles: [roleId] } : { parse: [] },
      content: changed ? `<@&${roleId}>\n${content}` : content,
    }),
    method: "PATCH",
  });
}

async function probeSiteStatus(statusUrl) {
  const response = await fetch(statusUrl, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
    },
    method: "GET",
  });

  const payload = await response.json().catch(() => ({}));
  return {
    details: payload,
    isActive: response.ok && payload && payload.status === "active",
    responseStatus: response.status,
  };
}

async function syncDiscordStatus(env) {
  const config = getStatusConfig(env);
  const statusProbe = await probeSiteStatus(config.statusUrl);
  const desiredDescription = buildStatusDescription(config.siteLabel, statusProbe.isActive);
  const currentApplication = await getCurrentApplication(config.botToken);
  const currentDescription = String(currentApplication?.description || "").trim();
  const changed = currentDescription !== desiredDescription;

  if (changed) {
    await updateApplicationDescription(config.botToken, desiredDescription);
  }

  await updateStatusMessage(
    config.botToken,
    config.channelId,
    config.messageId,
    buildStatusMessage(config.siteLabel, statusProbe.isActive),
    config.roleId,
    changed,
  );

  const result = {
    changed,
    checkedAt: new Date().toISOString(),
    responseStatus: statusProbe.responseStatus,
    status: statusProbe.isActive ? "online" : "offline",
  };

  console.log(JSON.stringify(result));
  return result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
