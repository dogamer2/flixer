const endpoint = String(process.env.LOCAL_ACCESS_CODE_URL || "http://localhost:3001/api/access/dev-generate");

async function main() {
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json"
    }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Failed to generate local code (${response.status})`);
  }

  const expiresAt = Number(payload.expiresAt || 0);
  const expiresLabel = Number.isFinite(expiresAt) && expiresAt > 0
    ? new Date(expiresAt * 1000).toISOString()
    : "unknown";

  console.log(payload.code);
  console.log(`expires: ${expiresLabel}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
