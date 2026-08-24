import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { PublicIntakeFormView } from "@/components/integrations/public-intake-form";
import { apiFetch } from "@/lib/api";
import { publicIntakeFormSchema } from "@/lib/public-intake";

export const dynamic = "force-dynamic";

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const applicationOrigin = host ? `${protocol}://${host}` : undefined;
  let form;
  try {
    form = publicIntakeFormSchema.parse(
      await apiFetch(
        `/api/v1/public/intake/forms/${encodeURIComponent(publicId)}`,
        applicationOrigin
          ? { headers: { Origin: applicationOrigin } }
          : undefined,
      ),
    );
  } catch {
    notFound();
  }

  return <PublicIntakeFormView form={form} />;
}
