function getRequiredEnv(name, fallback = "") {
  const value = String(process.env[name] || fallback).trim();

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function deriveApplicationId(token) {
  const firstSegment = String(token).split(".")[0];

  if (!firstSegment) {
    throw new Error("Unable to derive DISCORD_APPLICATION_ID from the bot token");
  }

  return Buffer.from(firstSegment, "base64url").toString("utf8");
}

async function main() {
  const botToken = getRequiredEnv("DISCORD_BOT_TOKEN", process.env.DISCORD_TOKEN);
  const applicationId =
    String(process.env.DISCORD_APPLICATION_ID || "").trim() || deriveApplicationId(botToken);
  const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();

  const endpoint = guildId
    ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${applicationId}/commands`;

  const commandPayload = [
    {
      description: "Generate a temporary site access code",
      name: "generatecode",
      type: 1,
    },
    {
      description: "Publish a formatted announcement update",
      name: "announce",
      options: [
        {
          description: "What changed or what people should know",
          name: "message",
          required: true,
          type: 3,
        },
      ],
      type: 1,
    },
    {
      description: "Post the reaction-role message in the reaction roles channel",
      name: "setupreact",
      type: 1,
    },
  ];

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commandPayload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Discord command registration failed (${response.status}): ${errorBody}`);
  }

  console.log(
    `Registered ${guildId ? "guild" : "global"} slash command(s) for Discord application ${applicationId}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
