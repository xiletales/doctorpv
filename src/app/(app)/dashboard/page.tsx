import { getServerSession } from "next-auth";
import { PageTitle } from "@/components/domain/status";
import { authOptions } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/types";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  return (
    <div className="p-4 md:p-6">
      <PageTitle
        title="Ringkasan energi RT"
        description={session ? `Masuk sebagai ${ROLE_LABEL[session.user.role]}.` : undefined}
      />
    </div>
  );
}
