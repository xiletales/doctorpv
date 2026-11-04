import type { Role } from "@/lib/types";

declare module "next-auth" {
  interface User {
    id: string;
    role: Role;
    houseId: string | null;
  }
  interface Session {
    user: { id: string; name: string; email: string; role: Role; houseId: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    houseId: string | null;
  }
}
