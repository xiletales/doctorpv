import type { Role } from "@/lib/types";

declare module "next-auth" {
  interface User {
    id: string;
    role: Role;
    gangIds: string[];
  }
  interface Session {
    user: { id: string; name: string; email: string; role: Role; gangIds: string[] };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    gangIds: string[];
  }
}
