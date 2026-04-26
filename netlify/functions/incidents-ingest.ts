export const config = {
  schedule: "0 */6 * * *",
};

const handler = async () => {
  const baseUrl = process.env.URL;
  const secret = process.env.PREDICTIONS_CRON_SECRET;

  if (!baseUrl || !secret) {
    throw new Error("Missing URL or PREDICTIONS_CRON_SECRET");
  }

  const res = await fetch(
    `${baseUrl}/api/incidents/ingest?lookbackDays=2&cronSecret=${encodeURIComponent(secret)}`,
    { method: "GET" },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Incidents ingest failed: ${res.status} ${text}`);
  }

  return new Response("ok", { status: 200 });
};

export default handler;
