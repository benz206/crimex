export const config = {
  schedule: "15 0 * * *",
};

const handler = async () => {
  const baseUrl = process.env.URL;
  const secret = process.env.PREDICTIONS_CRON_SECRET;

  if (!baseUrl || !secret) {
    throw new Error("Missing URL or PREDICTIONS_CRON_SECRET");
  }

  const res = await fetch(
    `${baseUrl}/api/markets/auto/seed?cronSecret=${encodeURIComponent(secret)}`,
    { method: "GET" },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Markets auto-seed failed: ${res.status} ${text}`);
  }

  return new Response("ok", { status: 200 });
};

export default handler;
