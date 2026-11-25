import { requireInternal } from "@/lib/auth/context";
import { REPORTS } from "@/lib/reports/definitions";
import { PageHeader } from "@/components/shell/page-header";
import { ReportIndex } from "@/components/shell/report-view";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireInternal();
  return (<><PageHeader title="Reports" description="Choose a report. Then pick dates, and press Print, PDF or Excel." /><ReportIndex ctx={ctx} reports={REPORTS} basePath="/admin/reports" /></>);
}
