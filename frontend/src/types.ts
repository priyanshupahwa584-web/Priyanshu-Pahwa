export type Role = 'Admin' | 'Manager' | 'Supervisor' | 'User';

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
  | 'settings'
  | 'security';

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  permissions: SectionKey[];
  twoFactorEnabled?: boolean;
};

export type NoticeType = 'success' | 'error' | 'info';
export type Notice = { type: NoticeType; text: string } | null;

export type FacilityAnalytics = {
  module: string;
  source: { sheetName: string; readOnly: boolean; range: string; latestDate: string };
  filters: { duration: string; aggregation: string; selectedFacilities: string[] };
  facilities: string[];
  kpis: {
    totalPackages: number;
    currentTotal: number;
    previousTotal: number;
    delta: number;
    activeFacilities: number;
    bestFacility: { facility: string; total: number } | null;
    worstFacility: { facility: string; total: number } | null;
    peakDay: { date: string; total: number } | null;
    rollingAverage: number;
  };
  dailyTotals: Array<{ date: string; total: number }>;
  facilityTotals: Array<{ facility: string; total: number }>;
  lineSeries: Array<Record<string, string | number>>;
  barSeries: Array<{ period: string; facility: string; total: number }>;
  pieSeries: Array<{ facility: string; total: number; percent: number }>;
  heatmap: Array<{ date: string; values: Array<{ facility: string; count: number }> }>;
  peakDays: Array<{ date: string; total: number }>;
  summary: string[];
  recordCount: number;
  generatedAt: string;
};

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
