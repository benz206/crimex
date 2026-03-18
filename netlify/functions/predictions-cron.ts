export const config = {
  schedule: "0 * * * *",
};

const handler = async () => {
  const baseUrl = process.env.URL;
  const secret = process.env.PREDICTIONS_CRON_SECRET;

  if (!baseUrl || !secret) {
    throw new Error("Missing URL or PREDICTIONS_CRON_SECRET");
  }

  const res = await fetch(
    `${baseUrl}/api/predictions/cron?cronSecret=${encodeURIComponent(secret)}&dailyTarget=100`,
    { method: "GET" },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Predictions cron failed: ${res.status} ${text}`);
  }

  return new Response("ok", { status: 200 });
};

export default handler;
