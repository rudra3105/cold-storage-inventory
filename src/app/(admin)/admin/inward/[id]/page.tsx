import { StockDocDetail } from "@/components/shell/stock-doc-pages";
export const metadata = { title: "Inward entry" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StockDocDetail kind="inward" id={(await params).id} />;
}
