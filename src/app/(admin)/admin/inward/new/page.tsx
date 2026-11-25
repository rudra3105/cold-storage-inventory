import { StockDocNew } from "@/components/shell/stock-doc-pages";
export const metadata = { title: "New inward" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <StockDocNew kind="inward" searchParams={await searchParams} />;
}
