import { requirePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PartyForm } from "@/components/forms/party-form";

export const metadata = { title: "Add party" };

export default async function NewParty() {
  await requirePermission("party.manage");
  return (
    <>
      <PageHeader title="Add party" />
      <Card><CardContent className="pt-5"><PartyForm id={null} canEdit initial={{ name: "", contact_person: "", mobile: "", email: "", address: "", city: "", state: "", gst_number: "", opening_balance: 0, remarks: "" }} /></CardContent></Card>
    </>
  );
}
