import { BatteryDetailView } from "./battery-detail";

export default async function BatteryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BatteryDetailView id={id} />;
}
