import { StockDocDetail } from "@/components/shell/stock-doc-pages";
export const metadata = { title: "Outward entry" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StockDocDetail kind="outward" id={(await params).id} />;
}
