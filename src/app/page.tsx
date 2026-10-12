import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const auth = await getAuth();
  redirect(auth ? "/dashboard" : "/login");
}
