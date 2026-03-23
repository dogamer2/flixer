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

  if (commandName !== "generatecode") {
    return discordMessageResponse("Unsupported command");
  }

  const interactionUserId = String(payload?.member?.user?.id || payload?.user?.id || "").trim();

  if (interactionUserId !== getAllowedDiscordUserId(env)) {
    return discordMessageResponse(getDeniedDiscordMessage());
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
