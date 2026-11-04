import { NextResponse } from "next/server";
import { gatewayKey } from "@/lib/live/gateway-key";
import { live } from "@/lib/live/store";

/** Lets a starting or offline simulator read its directive without sending telemetry. */
export async function GET(req: Request) {
  if (req.headers.get("x-gateway-key") !== gatewayKey("GW-1", process.env.GATEWAY_KEY_SECRET ?? "")) {
    return NextResponse.json({ error: "Kunci gateway tidak valid." }, { status: 401 });
  }
  await live.init();
  return NextResponse.json(live.directive);
}
