import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const auth = await getAuth();
  if (auth) redirect("/dashboard");
  return <RegisterForm />;
}
