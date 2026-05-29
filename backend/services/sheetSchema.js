export const tabs = {
  operations: 'OperationsData',
  users: 'Users',
  audit: 'AuditLogs',
  uploads: 'UploadLogs',
  exports: 'ExportLogs',
  metroLabeling: 'MetroLabeling',
  fulfilmentReports: 'FulfilmentReports',
  printLogs: 'PrintLogs',
  sessions: 'UserSessions'
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
    'updatedAt',
    'twoFactorEnabled',
    'twoFactorSecret',
    'twoFactorPendingSecret',
    'backupCodeHashes',
    'passwordChangedAt',
    'forcePasswordChange',
    'twoFactorRequired',
    'firstName',
    'lastName',
    'email'
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
    'updatedAt',
    'address',
    'city',
    'postalCode',
    'uploadedBy',
    'driver',
    'routingSequence',
    'deliveryAddress',
    'fullAddress',
    'originalRow',
    'printerName'
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
  ],
  [tabs.sessions]: [
    'id',
    'userId',
    'username',
    'device',
    'ip',
    'createdAt',
    'lastSeenAt',
    'expiresAt',
    'revokedAt',
    'revokedBy'
  ]
};

export const roles = ['Admin', 'Manager', 'Supervisor', 'Operator', 'Viewer'];

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
  'settings',
  'security'
];

export const defaultPermissionsByRole = {
  Admin: sections,
  Manager: ['dashboard', 'data', 'metro-labeling', 'fulfilment', 'imports', 'exports', 'users', 'activity', 'printer-setup', 'security'],
  Supervisor: ['dashboard', 'data', 'metro-labeling', 'fulfilment', 'imports', 'activity', 'printer-setup', 'security'],
  Operator: ['dashboard', 'metro-labeling', 'printer-setup', 'security'],
  Viewer: ['dashboard', 'data', 'activity', 'security']
};
