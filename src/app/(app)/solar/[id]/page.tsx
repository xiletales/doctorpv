import { SolarDetailView } from "./solar-detail";

export default async function SolarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SolarDetailView id={id} />;
}
