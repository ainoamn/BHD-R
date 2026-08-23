export interface InternalInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  minorUnit: number;
  totalMinor: bigint;
  paidMinor: bigint;
  issuedOn: string;
  dueOn: string;
  organizationDisplayName: string;
  tenantDisplayName: string;
  tenantEmail?: string | null;
  leaseId: string;
  organizationId: string;
  tenantPartyId: string;
  notes?: string | null;
}

export interface PublicInvoiceProjection {
  invoiceNumber: string;
  status: string;
  currency: string;
  minorUnit: number;
  totalMinor: string;
  outstandingMinor: string;
  issuedOn: string;
  dueOn: string;
  organizationDisplayName: string;
}

export function toPublicInvoice(invoice: InternalInvoice): PublicInvoiceProjection {
  return {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    minorUnit: invoice.minorUnit,
    totalMinor: invoice.totalMinor.toString(),
    outstandingMinor: (invoice.totalMinor - invoice.paidMinor).toString(),
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn,
    organizationDisplayName: invoice.organizationDisplayName,
  };
}
