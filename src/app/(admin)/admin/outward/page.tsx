import { StockDocList } from "@/components/shell/stock-doc-pages";
export const metadata = { title: "Outward" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <StockDocList kind="outward" searchParams={await searchParams} />;
}
