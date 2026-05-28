export type Role = 'Admin' | 'Supervisor' | 'Team Lead' | 'Scanner/User';

export type SectionKey =
  | 'dashboard'
  | 'data'
  | 'metro-labeling'
  | 'fulfilment'
  | 'imports'
  | 'exports'
  | 'users'
  | 'activity'
  | 'printer-setup'
  | 'settings';

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  permissions: SectionKey[];
};

export type NoticeType = 'success' | 'error' | 'info';
export type Notice = { type: NoticeType; text: string } | null;

export type OperationRow = {
  id: string;
  date: string;
  facility: string;
  pieces: string | number;
  throughput: string | number;
  productivity: string | number;
  cycleTime: string | number;
  status: string;
  notes: string;
};

export type MetroLabelRow = {
  id: string;
  trackingNumber: string;
  barcodeValue: string;
  customerName: string;
  service: string;
  route: string;
  status: 'Pending' | 'Printed' | 'Reprinted' | 'Error' | string;
  uploadedFileId: string;
  printedAt: string;
  printedBy: string;
  reprintCount: string | number;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
};

export type FulfilmentReport = {
  id: string;
  reportDate: string;
  client: string;
  service: string;
  route: string;
  totalUploaded: string | number;
  totalPrinted: string | number;
  pending: string | number;
  errors: string | number;
  completionPercent: string | number;
  createdBy: string;
  createdAt: string;
};
