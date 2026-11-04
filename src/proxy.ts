import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { canOpenPage, homeFor } from "./lib/rbac";

const PUBLIC = ["/login", "/api/auth", "/api/v1/ingest", "/api/v1/sim"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const token = await getToken({ req });
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sesi berakhir. Masuk kembali." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (pathname === "/") return NextResponse.redirect(new URL(homeFor(token.role), req.url));
  if (!pathname.startsWith("/api/") && !canOpenPage(token.role, pathname)) {
    return NextResponse.redirect(new URL(homeFor(token.role), req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|jpg|mjs)$).*)"],
};
