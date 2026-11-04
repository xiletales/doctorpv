import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";
import { can, type Action } from "./rbac";
import type { SessionUser } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser(action?: Action): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new ApiError(401, "Sesi berakhir. Masuk kembali untuk melanjutkan.");
  // Warga have their own endpoint and never read cluster-wide data.
  if (session.user.role === "warga") throw new ApiError(403, "Peran Anda tidak memiliki akses untuk tindakan ini.");
  if (action && !can(session.user.role, action)) {
    throw new ApiError(403, "Peran Anda tidak memiliki akses untuk tindakan ini.");
  }
  return session.user;
}

export async function requireResident(): Promise<SessionUser & { houseId: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new ApiError(401, "Sesi berakhir. Masuk kembali untuk melanjutkan.");
  if (session.user.role !== "warga" || !session.user.houseId) throw new ApiError(403, "Halaman ini khusus untuk warga.");
  return { ...session.user, houseId: session.user.houseId };
}

/** Wraps a route handler so that thrown ApiErrors become JSON responses. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error(err);
      return NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });
    }
  };
}
