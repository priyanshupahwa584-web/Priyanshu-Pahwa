export const tabs = {
  operations: 'OperationsData',
  users: 'Users',
  audit: 'AuditLogs',
  uploads: 'UploadLogs',
  exports: 'ExportLogs',
  metroLabeling: 'MetroLabeling',
  fulfilmentReports: 'FulfilmentReports',
  printLogs: 'PrintLogs'
};

export const sheetHeaders = {
  [tabs.operations]: [
    'id',
    'date',
    'facility',
    'pieces',
    'throughput',
    'productivity',
    'cycleTime',
    'status',
    'notes',
    'createdAt',
    'updatedAt',
    'createdBy'
  ],
  [tabs.users]: [
    'id',
    'username',
    'displayName',
    'passwordHash',
    'role',
    'active',
    'permissions',
    'failedLoginCount',
    'lockedUntil',
    'lastLogin',
    'createdAt',
    'updatedAt'
  ],
  [tabs.audit]: ['id', 'actor', 'action', 'entity', 'entityId', 'ip', 'device', 'metadata', 'createdAt'],
  [tabs.uploads]: ['id', 'fileName', 'mimeType', 'driveFileId', 'size', 'uploadedBy', 'status', 'message', 'createdAt'],
  [tabs.exports]: ['id', 'type', 'format', 'filters', 'rowCount', 'requestedBy', 'driveFileId', 'fileName', 'createdAt']
  ,
  [tabs.metroLabeling]: [
    'id',
    'trackingNumber',
    'barcodeValue',
    'customerName',
    'service',
    'route',
    'status',
    'uploadedFileId',
    'printedAt',
    'printedBy',
    'reprintCount',
    'errorMessage',
    'createdAt',
    'updatedAt'
  ],
  [tabs.fulfilmentReports]: [
    'id',
    'reportDate',
    'client',
    'service',
    'route',
    'totalUploaded',
    'totalPrinted',
    'pending',
    'errors',
    'completionPercent',
    'createdBy',
    'createdAt'
  ],
  [tabs.printLogs]: [
    'id',
    'trackingNumber',
    'action',
    'userId',
    'status',
    'printerName',
    'timestamp',
    'errorMessage'
  ]
};

export const roles = ['Admin', 'Supervisor', 'Team Lead', 'Scanner/User'];

export const sections = [
  'dashboard',
  'data',
  'metro-labeling',
  'fulfilment',
  'imports',
  'exports',
  'users',
  'activity',
  'printer-setup',
  'settings'
];

export const defaultPermissionsByRole = {
  Admin: sections,
  Supervisor: ['dashboard', 'data', 'metro-labeling', 'fulfilment', 'imports', 'exports', 'activity', 'printer-setup'],
  'Team Lead': ['dashboard', 'data', 'metro-labeling', 'fulfilment', 'imports', 'activity', 'printer-setup'],
  'Scanner/User': ['dashboard']
};
