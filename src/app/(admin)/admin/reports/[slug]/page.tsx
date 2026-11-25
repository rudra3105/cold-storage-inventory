import { requireInternal } from "@/lib/auth/context";
import { ReportView } from "@/components/shell/report-view";

export const metadata = { title: "Report" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireInternal();
  const { slug } = await params;
  return <ReportView slug={slug} sp={await searchParams} ctx={ctx} basePath={`/admin/reports/${slug}`} />;
}
