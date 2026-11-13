"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { deleteAddress } from "@/lib/addresses";
import { getViewer } from "@/lib/auth";

/** Remove a saved address. RLS limits the delete to the viewer's own rows. */
export async function removeAddress(form: FormData): Promise<void> {
  if (!(await getViewer())) redirect("/login");
  const id = String(form.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await deleteAddress(id);
  refresh();
}
