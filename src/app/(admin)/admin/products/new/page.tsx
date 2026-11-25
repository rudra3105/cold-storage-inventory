import { requirePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ProductForm } from "@/components/forms/product-form";

export const metadata = { title: "Add product" };

export default async function NewProduct() {
  await requirePermission("product.manage");
  return (
    <>
      <PageHeader title="Add product" />
      <Card><CardContent className="pt-5"><ProductForm id={null} canEdit initial={{ name: "", category: "", description: "", default_unit: "BAG", default_kgs_per_bag: null }} /></CardContent></Card>
    </>
  );
}
