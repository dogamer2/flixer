import {
  createAccessCode,
  formatDurationLabel,
  getAllowedDiscordUserId,
  getCodeTtlSeconds,
  getDeniedDiscordMessage,
  getDiscordPublicKey,
  jsonResponse,
  textResponse,
  verifyDiscordInteraction,
} from "../../_shared/access.js";

const DISCORD_INTERACTION_PING = 1;
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2;
const DISCORD_INTERACTION_CHANNEL_MESSAGE = 4;
const DISCORD_FLAG_EPHEMERAL = 1 << 6;
const ANNOUNCEMENT_ROLE_ID = "1485576547829022840";
const REACTION_ROLE_CHANNEL_ID = "1485575611081687090";
const STATUS_ROLE_ID = "1485575817718403072";
const ROLE_MENU_MARKER = "[role-menu-v2]";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return textResponse("", 204);
  }

  if (request.method !== "POST") {
    return textResponse("Method not allowed", 405);
  }

  try {
    getDiscordPublicKey(env);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Discord interactions misconfigured" },
      503,
    );
  }

  const rawBody = await request.arrayBuffer();
  const isValidSignature = await verifyDiscordInteraction(request, env, rawBody);

  if (!isValidSignature) {
    return textResponse("Invalid request signature", 401);
  }

  let payload;

  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch (_error) {
    return jsonResponse({ error: "Invalid interaction payload" }, 400);
  }

  if (payload?.type === DISCORD_INTERACTION_PING) {
    return jsonResponse({ type: DISCORD_INTERACTION_PING });
  }

  if (payload?.type !== DISCORD_INTERACTION_APPLICATION_COMMAND) {
    return discordMessageResponse("Unsupported interaction type");
  }

  const commandName = String(payload?.data?.name || "").toLowerCase();

  if (commandName !== "generatecode" && commandName !== "announce" && commandName !== "setupreact") {
    return discordMessageResponse("Unsupported command");
  }

  const interactionUserId = String(payload?.member?.user?.id || payload?.user?.id || "").trim();

  if (interactionUserId !== getAllowedDiscordUserId(env)) {
    return discordMessageResponse(getDeniedDiscordMessage());
  }

  if (commandName === "announce") {
    const rawMessage = getStringOption(payload, "message");

    if (!rawMessage) {
      return discordMessageResponse("Add a message for the announcement.");
    }

    const botToken = String(env?.DISCORD_BOT_TOKEN || env?.DISCORD_TOKEN || "").trim();

    if (!botToken) {
      return discordMessageResponse("Discord bot token is missing.");
    }

    try {
      await discordApiRequest(`/channels/${payload.channel_id}/messages`, botToken, {
        body: JSON.stringify({
          content: formatAnnouncementMessage(rawMessage),
        }),
        method: "POST",
      });
    } catch (error) {
      return discordMessageResponse(
        error instanceof Error ? error.message : "Failed to publish announcement",
      );
    }

    return discordMessageResponse("Announcement posted.");
  }

  if (commandName === "setupreact") {
    const botToken = String(env?.DISCORD_BOT_TOKEN || env?.DISCORD_TOKEN || "").trim();

    if (!botToken) {
      return discordMessageResponse("Discord bot token is missing.");
    }

    try {
      const message = await discordApiRequest(`/channels/${REACTION_ROLE_CHANNEL_ID}/messages`, botToken, {
        body: JSON.stringify({
          content: buildReactionRoleMessage(),
        }),
        method: "POST",
      });

      await discordReactionRequest(
        `/channels/${REACTION_ROLE_CHANNEL_ID}/messages/${message.id}/reactions/${encodeURIComponent("1️⃣")}/@me`,
        botToken,
        "PUT",
      );
    } catch (error) {
      return discordMessageResponse(
        error instanceof Error ? error.message : "Failed to post reaction-role message",
      );
    }

    return discordMessageResponse("Reaction-role message posted.");
  }

  let accessCode;

  try {
    accessCode = await createAccessCode(env, request, interactionUserId);
  } catch (error) {
    return discordMessageResponse(
      error instanceof Error ? error.message : "Failed to generate access code",
    );
  }

  const ttlLabel = formatDurationLabel(getCodeTtlSeconds(env));

  return discordMessageResponse(
    `One-time access code for the site, expires in ${ttlLabel}:\n\`${accessCode}\`\n\nThis code works once. Paste it into the gate screen to unlock access.`,
  );
}

function discordMessageResponse(content) {
  return jsonResponse({
    data: {
      content,
      flags: DISCORD_FLAG_EPHEMERAL,
    },
    type: DISCORD_INTERACTION_CHANNEL_MESSAGE,
  });
}

function getStringOption(payload, optionName) {
  const options = Array.isArray(payload?.data?.options) ? payload.data.options : [];
  const match = options.find((option) => String(option?.name || "").toLowerCase() === optionName);
  return String(match?.value || "").trim();
}

async function discordApiRequest(path, token, init = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
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

async function discordReactionRequest(path, token, method) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      authorization: `Bot ${token}`,
    },
    method,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorBody}`);
  }
}

function formatAnnouncementMessage(rawMessage) {
  const cleaned = String(rawMessage || "").replace(/\s+/g, " ").trim();
  const normalized = cleaned.replace(/\s*([.!?])\s*/g, "$1 ").trim();
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const lines = sentences.length > 1 ? sentences : [ensureSentence(normalized)];

  return [
    `<@&${ANNOUNCEMENT_ROLE_ID}>`,
    "**Announcement**",
    lines.map((line) => `- ${ensureSentence(line)}`).join("\n"),
    "",
    `React with 2️⃣ in <#${REACTION_ROLE_CHANNEL_ID}> to get future announcement alerts.`,
  ].join("\n");
}

function buildReactionRoleMessage() {
  return [
    ROLE_MENU_MARKER,
    "**Stay in the loop**",
    "React below if you want to be notified when the site status changes.",
    "",
    `1️⃣ <@&${STATUS_ROLE_ID}> for online and offline status alerts`,
    "",
    "Remove your reaction any time to opt out.",
  ].join("\n");
}

function ensureSentence(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}
