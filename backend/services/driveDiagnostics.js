import { Readable } from 'node:stream';
import { config, driveStorageConfigured, googleCredentialsConfigured, googleCredentialsError } from '../config.js';
import { getDriveClient } from './googleClient.js';

const folderMime = 'application/vnd.google-apps.folder';
const textMime = 'text/plain';
const cacheTtlMs = 60 * 1000;
let cachedDiagnostic = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function googleErrorDetails(error = {}) {
  const responseError = error?.response?.data?.error || {};
  const firstDetail = responseError.errors?.[0] || error?.errors?.[0] || {};
  const message = String(responseError.message || error.message || '').slice(0, 300);
  const reason = String(firstDetail.reason || responseError.status || error.code || '').slice(0, 120);
  const status = Number(error?.code || error?.response?.status || responseError.code || 0);
  return { message, reason, status };
}

function driveMessage(code, detail = {}) {
  const email = config.google.clientEmail || 'the configured service account';
  if (code === 'folder_id_missing') return 'GOOGLE_DRIVE_FOLDER_ID is not set.';
  if (code === 'google_credentials_missing') return googleCredentialsError() || 'Google service account credentials are not configured.';
  if (code === 'service_account_mismatch') return `Google Drive rejected the configured service account (${email}). Verify GOOGLE_SERVICE_ACCOUNT_JSON is the same service account shared on the Drive folder.`;
  if (code === 'drive_api_disabled') return 'Google Drive API is disabled for the configured Google Cloud project.';
  if (code === 'folder_not_accessible') return `Drive folder is not accessible to ${email}. Confirm GOOGLE_DRIVE_FOLDER_ID and share the folder with this service account.`;
  if (code === 'permission_denied') return `Drive permission denied for ${email}. Share the BROPS Storage folder with this service account as Editor.`;
  if (code === 'drive_request_failed') return detail.message || 'Google Drive storage check failed.';
  return 'Google Drive storage check failed.';
}

export function classifyDriveError(error, context = {}) {
  if (!config.google.driveFolderId) {
    return {
      driveErrorCode: 'folder_id_missing',
      driveErrorMessage: driveMessage('folder_id_missing'),
      driveErrorStatus: 0
    };
  }
  if (!googleCredentialsConfigured()) {
    const code = config.google.configError ? 'service_account_mismatch' : 'google_credentials_missing';
    return {
      driveErrorCode: code,
      driveErrorMessage: driveMessage(code),
      driveErrorStatus: 0
    };
  }

  const details = googleErrorDetails(error);
  const combined = `${details.reason} ${details.message}`.toLowerCase();
  let code = context.defaultCode || 'drive_request_failed';

  if (details.status === 404 || /file not found|not found/i.test(details.message)) {
    code = 'folder_not_accessible';
  } else if (details.status === 401 || /invalid_grant|unauthorized_client|invalid client/i.test(combined)) {
    code = 'service_account_mismatch';
  } else if (/accessnotconfigured|service_disabled|api.*disabled|has not been used|disabled/i.test(combined)) {
    code = 'drive_api_disabled';
  } else if (details.status === 403 || /forbidden|permission|insufficient/i.test(combined)) {
    code = 'permission_denied';
  }

  return {
    driveErrorCode: code,
    driveErrorMessage: driveMessage(code, details),
    driveErrorStatus: details.status,
    driveErrorReason: details.reason
  };
}

export function createDriveStorageError(error, context = {}) {
  const classified = classifyDriveError(error, context);
  const storageError = new Error(classified.driveErrorMessage);
  storageError.statusCode = 503;
  storageError.driveErrorCode = classified.driveErrorCode;
  storageError.driveErrorMessage = classified.driveErrorMessage;
  storageError.driveErrorStatus = classified.driveErrorStatus;
  return storageError;
}

function baseDiagnostic() {
  return {
    driveStorageConfigured: driveStorageConfigured(),
    driveStorageWritable: false,
    driveFolderIdPresent: Boolean(config.google.driveFolderId),
    driveFolderAccessible: false,
    serviceAccountEmail: config.google.clientEmail || '',
    serviceAccountSource: config.google.credentialsSource || '',
    serviceAccountJsonPresent: Boolean(config.google.serviceAccountJsonPresent),
    driveErrorCode: '',
    driveErrorMessage: '',
    driveErrorStatus: 0,
    driveErrorReason: '',
    rootFolderName: '',
    rootFolderMimeType: '',
    rootFolderCanAddChildren: false,
    rootFolderCanEdit: false,
    writeProbeAttempted: false,
    writeProbeFolderCreated: false,
    writeProbeFileCreated: false,
    writeProbeCleanedUp: false
  };
}

function applyError(result, error, context) {
  const classified = classifyDriveError(error, context);
  result.driveStorageWritable = false;
  result.driveErrorCode = classified.driveErrorCode;
  result.driveErrorMessage = classified.driveErrorMessage;
  result.driveErrorStatus = classified.driveErrorStatus || 0;
  result.driveErrorReason = classified.driveErrorReason || '';
  return result;
}

async function cleanupProbe(drive, fileId) {
  if (!fileId) return true;
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
    return true;
  } catch {
    return false;
  }
}

async function runWriteProbe(drive, result) {
  result.writeProbeAttempted = true;
  let folderId = '';
  let fileId = '';
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folder = await drive.files.create({
      requestBody: {
        name: `.brops-drive-check-${stamp}`,
        mimeType: folderMime,
        parents: [config.google.driveFolderId]
      },
      fields: 'id,name',
      supportsAllDrives: true
    });
    folderId = folder.data.id || '';
    result.writeProbeFolderCreated = Boolean(folderId);

    const file = await drive.files.create({
      requestBody: {
        name: 'drive-check.txt',
        parents: [folderId]
      },
      media: {
        mimeType: textMime,
        body: Readable.from(['BROPS Drive storage write check'])
      },
      fields: 'id,name,size',
      supportsAllDrives: true
    });
    fileId = file.data.id || '';
    result.writeProbeFileCreated = Boolean(fileId);
    result.driveStorageWritable = result.writeProbeFolderCreated && result.writeProbeFileCreated;
  } finally {
    const fileCleaned = await cleanupProbe(drive, fileId);
    const folderCleaned = await cleanupProbe(drive, folderId);
    result.writeProbeCleanedUp = fileCleaned && folderCleaned;
  }
}

export async function runDriveStorageDiagnostics({ writeProbe = false, force = false, includeFolderId = false } = {}) {
  if (!force && cachedDiagnostic && Date.now() - cachedDiagnostic.at < cacheTtlMs && (!writeProbe || cachedDiagnostic.writeProbe)) {
    const cached = clone(cachedDiagnostic.value);
    if (includeFolderId) cached.configuredFolderId = config.google.driveFolderId || '';
    return cached;
  }

  const result = baseDiagnostic();
  if (includeFolderId) result.configuredFolderId = config.google.driveFolderId || '';
  if (!result.driveFolderIdPresent) return applyError(result, null, { defaultCode: 'folder_id_missing' });
  if (!googleCredentialsConfigured()) return applyError(result, null, { defaultCode: 'google_credentials_missing' });

  try {
    const drive = getDriveClient();
    const root = await drive.files.get({
      fileId: config.google.driveFolderId,
      fields: 'id,name,mimeType,capabilities(canAddChildren,canEdit)',
      supportsAllDrives: true
    });
    result.driveFolderAccessible = true;
    result.rootFolderName = root.data.name || '';
    result.rootFolderMimeType = root.data.mimeType || '';
    result.rootFolderCanAddChildren = Boolean(root.data.capabilities?.canAddChildren);
    result.rootFolderCanEdit = Boolean(root.data.capabilities?.canEdit);

    if (!result.rootFolderCanAddChildren && !result.rootFolderCanEdit) {
      return applyError(result, null, { defaultCode: 'permission_denied' });
    }

    if (writeProbe) {
      await runWriteProbe(drive, result);
    } else {
      result.driveStorageWritable = true;
    }
  } catch (error) {
    applyError(result, error);
  }

  cachedDiagnostic = { at: Date.now(), writeProbe, value: clone(result) };
  return result;
}
