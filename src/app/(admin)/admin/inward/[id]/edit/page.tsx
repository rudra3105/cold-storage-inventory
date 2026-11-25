import { StockDocEdit } from "@/components/shell/stock-doc-pages";
export const metadata = { title: "Modify inward" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StockDocEdit kind="inward" id={(await params).id} />;
}
