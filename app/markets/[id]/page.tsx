import { MarketClient } from "./ui";

export default function MarketPage({ params }: { params: { id: string } }) {
  return <MarketClient marketId={params.id} />;
}
