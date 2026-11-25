import { StockDocEdit } from "@/components/shell/stock-doc-pages";
export const metadata = { title: "Modify outward" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StockDocEdit kind="outward" id={(await params).id} />;
}
