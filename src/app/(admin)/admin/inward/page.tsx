import { StockDocList } from "@/components/shell/stock-doc-pages";
export const metadata = { title: "Inward" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <StockDocList kind="inward" searchParams={await searchParams} />;
}
