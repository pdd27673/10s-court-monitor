import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, registrationRequests } from "@/lib/schema";
import { eq, count } from "drizzle-orm";
import AdminSidebar from "./components/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email.toLowerCase()))
    .limit(1);

  if (!user[0] || !user[0].isAdmin) {
    redirect("/dashboard");
  }

  const pendingCount = await db
    .select({ count: count() })
    .from(registrationRequests)
    .where(eq(registrationRequests.status, "pending"));

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      <AdminSidebar pendingRequestsCount={pendingCount[0].count} />
      <div className="flex-1 p-8 ml-64 max-w-full overflow-x-auto">
        {children}
      </div>
    </div>
  );
}
