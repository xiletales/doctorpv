import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "./db";
import type { Role } from "./types";

const credentials = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentials.safeParse(raw);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: { gangs: true },
        });
        if (!user || !user.active) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as Role,
          gangIds: user.gangs.map((g) => g.gangId),
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.gangIds = user.gangIds;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        id: token.id,
        name: token.name ?? "",
        email: token.email ?? "",
        role: token.role,
        gangIds: token.gangIds,
      };
      return session;
    },
  },
};
