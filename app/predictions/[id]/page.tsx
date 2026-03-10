import { PredictionDetailClient } from "./ui";

export default async function PredictionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PredictionDetailClient runId={id} />;
}
