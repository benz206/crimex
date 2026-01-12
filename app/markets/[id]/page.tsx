import { MarketClient } from "./ui";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MarketClient marketId={id} />;
}
