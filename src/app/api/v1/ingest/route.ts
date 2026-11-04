import { NextResponse } from "next/server";
import { ingestBatch } from "@/lib/contracts/telemetry";
import { gatewayKey } from "@/lib/live/gateway-key";
import { live } from "@/lib/live/store";

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = ingestBatch.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Payload tidak valid." }, { status: 400 });
  const expected = gatewayKey(parsed.data.gatewayId, process.env.GATEWAY_KEY_SECRET ?? "");
  if (req.headers.get("x-gateway-key") !== expected) {
    return NextResponse.json({ error: "Kunci gateway tidak valid." }, { status: 401 });
  }
  const result = await live.ingest(parsed.data.gatewayId, parsed.data.messages);
  return NextResponse.json(result);
}
