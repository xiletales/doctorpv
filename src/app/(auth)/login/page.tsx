import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { homeFor } from "@/lib/rbac";
import { LoginView } from "./login-view";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect(homeFor(session.user.role));
  return <LoginView demo={process.env.NEXT_PUBLIC_DEMO_MODE === "true"} />;
}
