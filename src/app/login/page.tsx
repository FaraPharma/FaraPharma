import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const auth = await getAuth();
  if (auth) redirect("/dashboard");
  return <LoginForm />;
}
