import { z } from "zod";

const num = (label: string) => z.number({ error: `${label} is required` });
const optText = z.string().trim().max(500).optional().or(z.literal(""));
const mobile = z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, "Enter a valid mobile number").optional().or(z.literal(""));

export const partySchema = z.object({
  name: z.string().trim().min(2, "Party name is required").max(150),
  contact_person: optText, mobile,
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  address: optText, city: z.string().trim().max(80).optional().or(z.literal("")), state: z.string().trim().max(80).optional().or(z.literal("")),
  gst_number: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GST number format is invalid").optional().or(z.literal("")),
  opening_balance: num("Opening balance").min(-1e11).max(1e11),
  remarks: optText,
});
export type PartyValues = z.infer<typeof partySchema>;

export const productSchema = z.object({
  name: z.string().trim().min(2, "Product name is required").max(120),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  description: optText,
  default_unit: z.string().trim().min(1, "Unit is required").max(20),
  default_kgs_per_bag: z.number().positive("Must be greater than 0").max(10000).nullable().optional(),
});
export type ProductValues = z.infer<typeof productSchema>;

export const lineSchema = z.object({
  product_id: z.uuid({ error: "Select a product" }),
  chamber_id: z.uuid({ error: "Select a chamber" }),
  floor_id: z.uuid({ error: "Select a floor" }),
  rack_id: z.uuid({ error: "Select a rack" }),
  bags: num("Bags").int("Whole bags only").positive("Must be greater than 0").max(1_000_000),
  kgs_per_bag: num("Kgs / bag").positive("Must be greater than 0").max(10000),
  wages_party: num("Wages").min(0, "Cannot be negative").max(1e9),
  wages_labour: num("Wages").min(0, "Cannot be negative").max(1e9),
  remarks: z.string().trim().max(300).optional().or(z.literal("")),
});
export type LineValues = z.infer<typeof lineSchema>;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a date");
const vehicle = z.string().trim().max(20, "Too long").optional().or(z.literal(""));

export const inwardSchema = z.object({
  inward_date: dateStr, party_id: z.uuid({ error: "Select a party" }), vehicle_no: vehicle,
  wb_kgs: z.number().min(0, "Cannot be negative").nullable().optional(),
  remarks: optText, lines: z.array(lineSchema).min(1, "Add at least one product line").max(100),
});
export type InwardValues = z.infer<typeof inwardSchema>;

export const outwardSchema = z.object({
  outward_date: dateStr, party_id: z.uuid({ error: "Select a party" }), vehicle_no: vehicle,
  outward_request_id: z.uuid().nullable().optional(),
  remarks: optText, lines: z.array(lineSchema).min(1, "Add at least one product line").max(100),
});
export type OutwardValues = z.infer<typeof outwardSchema>;

export const invoiceSchema = z.object({
  party_id: z.uuid({ error: "Select a party" }), invoice_date: dateStr,
  due_date: dateStr.optional().or(z.literal("")), period_from: dateStr.optional().or(z.literal("")), period_to: dateStr.optional().or(z.literal("")),
  notes: optText,
  items: z.array(z.object({
    description: z.string().trim().min(1, "Description required").max(300),
    charge_type_id: z.string().optional().or(z.literal("")),
    quantity: num("Quantity").min(0), unit: z.string().trim().max(20).optional().or(z.literal("")),
    rate: num("Rate").min(0), tax_percent: num("Tax").min(0).max(100),
  })).min(1, "Add at least one line"),
});
export type InvoiceValues = z.infer<typeof invoiceSchema>;

export const PAYMENT_MODES = [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["upi", "UPI"], ["cheque", "Cheque"], ["other", "Other"]] as const;
const modeEnum = z.enum(["cash", "bank_transfer", "upi", "cheque", "other"], { error: "Select a mode" });

export const receiptSchema = z.object({
  party_id: z.uuid({ error: "Select a party" }), receipt_date: dateStr, amount: num("Amount").positive("Must be greater than 0"),
  payment_mode: modeEnum, reference_no: z.string().trim().max(80).optional().or(z.literal("")), remarks: optText,
  allocations: z.array(z.object({ invoice_id: z.string(), amount: z.number().min(0) })),
});
export type ReceiptValues = z.infer<typeof receiptSchema>;

export const paymentSchema = z.object({
  party_id: z.string().optional().or(z.literal("")), payee_name: z.string().trim().max(150).optional().or(z.literal("")),
  payment_date: dateStr, amount: num("Amount").positive("Must be greater than 0"), payment_mode: modeEnum,
  purpose: z.string().trim().max(200).optional().or(z.literal("")), reference_no: z.string().trim().max(80).optional().or(z.literal("")), remarks: optText,
}).refine((v) => v.party_id || (v.payee_name && v.payee_name.length > 0), { path: ["payee_name"], message: "Enter the payee or choose a party" });
export type PaymentValues = z.infer<typeof paymentSchema>;

export const adjustmentSchema = z.object({
  party_id: z.uuid({ error: "Select a party" }), product_id: z.uuid({ error: "Select a product" }), rack_id: z.uuid({ error: "Select a rack" }),
  bags_delta: num("Bags").int("Whole bags only"), kgs_delta: num("Kgs"), adj_date: dateStr,
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(300),
}).refine((v) => v.bags_delta !== 0 || v.kgs_delta !== 0, { path: ["bags_delta"], message: "Adjustment cannot be zero" });
export type AdjustmentValues = z.infer<typeof adjustmentSchema>;

export const rackSchema = z.object({
  floor_id: z.uuid(), code: z.string().trim().min(1, "Rack code is required").max(30),
  capacity_bags: z.number().int().positive("Must be greater than 0").nullable().optional(),
});
export const settingsSchema = z.object({
  business_name: z.string().trim().min(2).max(150), address: optText, phone: optText,
  email: z.string().trim().email().optional().or(z.literal("")), gst_number: optText, invoice_terms: z.string().trim().max(1000).optional().or(z.literal("")),
  customer_can_see_rack: z.boolean(), outward_requests_enabled: z.boolean(),
});
export const staffSchema = z.object({
  full_name: z.string().trim().min(2, "Name is required").max(100), phone: optText,
  email: z.string().trim().email("Enter a valid email"), password: z.string().min(10, "At least 10 characters").max(100),
  role: z.enum(["manager", "staff", "accountant"], { error: "Select a role" }),
});
export const requestSchema = z.object({
  product_id: z.uuid({ error: "Select a product" }), bags: num("Quantity").int("Whole bags only").positive("Must be greater than 0"),
  preferred_date: dateStr.optional().or(z.literal("")), remarks: optText,
});
