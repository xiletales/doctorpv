import { createHmac } from "node:crypto";

/** Per-gateway API key, derived so that each gateway holds a different credential. */
export function gatewayKey(gatewayId: string, secret: string): string {
  return createHmac("sha256", secret).update(gatewayId).digest("hex");
}
