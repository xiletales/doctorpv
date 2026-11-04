import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ResidentView } from "./resident-view";

export default async function ResidentPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "warga") redirect("/dashboard");
  return <ResidentView />;
}
