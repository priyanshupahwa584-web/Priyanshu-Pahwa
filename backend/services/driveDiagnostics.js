import { Readable } from 'node:stream';
import {
  config,
  driveAuthMode,
  driveCredentialsConfigured,
  driveCredentialsError,
  driveOAuthDiagnostic,
  driveStorageConfigured
} from '../config.js';
import { getDriveClient } from './googleClient.js';

const folderMime = 'application/vnd.google-apps.folder';
const textMime = 'text/plain';
const cacheTtlMs = 60 * 1000;
let cachedDiagnostic = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function googleErrorDetails(error = {}) {
  const responseData = error?.response?.data || {};
  const responseError = typeof responseData.error === 'object' && responseData.error !== null ? responseData.error : {};
  const oauthError = typeof responseData.error === 'string' ? responseData.error : '';
  const oauthErrorDescription = typeof responseData.error_description === 'string' ? responseData.error_description : '';
  const firstDetail = responseError.errors?.[0] || error?.errors?.[0] || {};
  const message = String(responseError.message || oauthErrorDescription || error.message || oauthError || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const reason = String(firstDetail.reason || oauthError || responseError.status || error.code || '').slice(0, 120);
  const status = Number(error?.response?.status || responseError.code || error?.code || 0) || 0;
  return { message, reason, status };
}

function driveMessage(code, detail = {}) {
  const email = config.google.clientEmail || 'the configured service account';
  const actor = driveAuthMode() === 'oauth' ? 'OAuth Drive user' : 'service account';
  if (code === 'folder_id_missing') return 'GOOGLE_DRIVE_FOLDER_ID is not set.';
  if (code === 'google_credentials_missing') return driveCredentialsError() || 'Google Drive storage credentials are not configured.';
  if (code === 'drive_oauth_missing') return driveCredentialsError() || 'Google Drive OAuth credentials are not configured.';
  if (code === 'drive_oauth_refresh_failed') return 'Google Drive OAuth refresh token failed. Regenerate GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN for the configured OAuth client.';
  if (code === 'drive_oauth_rejected') return 'Google Drive OAuth credentials were rejected. Regenerate GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN for the configured OAuth client.';
  if (code === 'service_account_mismatch') return `Google Drive rejected the configured service account (${email}). Verify GOOGLE_SERVICE_ACCOUNT_JSON is the same service account shared on the Drive folder.`;
  if (code === 'drive_api_disabled') return 'Google Drive API is disabled for the configured Google Cloud project.';
  if (code === 'folder_not_accessible') return 'GOOGLE_DRIVE_FOLDER_ID does not point to the shared BROPS Storage folder.';
  if (code === 'not_a_folder') return 'GOOGLE_DRIVE_FOLDER_ID does not point to the shared BROPS Storage folder.';
  if (code === 'wrong_folder') return 'GOOGLE_DRIVE_FOLDER_ID does not point to the shared BROPS Storage folder.';
  if (code === 'cannot_add_children') return `Folder is accessible but this ${actor} cannot add files.`;
  if (code === 'service_account_storage_quota') return 'Google service account has no Drive storage quota. Use OAuth user Drive storage or Shared Drive.';
  if (code === 'drive_storage_quota') return 'Google Drive storage quota exceeded. Free Drive storage or use a different OAuth user Drive storage.';
  if (code === 'permission_denied') {
    if (driveAuthMode() === 'oauth') return 'Drive permission denied for the configured OAuth user. Share the BROPS Storage folder with that user as Editor.';
    return `Drive permission denied for ${email}. Share the BROPS Storage folder with this service account as Editor.`;
  }
  if (code === 'drive_request_failed') return detail.message || 'Google Drive storage check failed.';
  return 'Google Drive storage check failed.';
}

function looksLikeStorageQuotaExceeded(details) {
  const combined = `${details.reason} ${details.message}`.toLowerCase();
  return /storagequotaexceeded|storage quota|quota exceeded|service account.*quota|cannot.*own|ownership|my drive/.test(combined);
}

function looksLikeOAuthRefreshFailure(details) {
  const combined = `${details.reason} ${details.message}`.toLowerCase();
  return /invalid_grant|invalid_client|unauthorized_client|refresh token|token has been expired|token has been revoked/.test(combined);
}

export function classifyDriveError(error, context = {}) {
  if (!config.google.driveFolderId) {
    return {
      driveErrorCode: 'folder_id_missing',
      driveErrorMessage: driveMessage('folder_id_missing'),
      driveErrorStatus: 0
    };
  }
  if (!driveCredentialsConfigured()) {
    const code = config.google.driveOAuthPresent ? 'drive_oauth_missing' : (config.google.configError ? 'service_account_mismatch' : 'google_credentials_missing');
    return {
      driveErrorCode: code,
      driveErrorMessage: driveMessage(code),
      driveErrorStatus: 0
    };
  }

  const details = googleErrorDetails(error);
  const combined = `${details.reason} ${details.message}`.toLowerCase();
  let code = context.defaultCode || 'drive_request_failed';

  if (context.defaultCode) {
    code = context.defaultCode;
  } else if (details.status === 404 || /file not found|not found/i.test(details.message)) {
    code = 'folder_not_accessible';
  } else if (driveAuthMode() === 'oauth' && looksLikeOAuthRefreshFailure(details)) {
    code = 'drive_oauth_refresh_failed';
  } else if (details.status === 401 || /invalid_grant|unauthorized_client|invalid client/i.test(combined)) {
    code = driveAuthMode() === 'oauth' ? 'drive_oauth_rejected' : 'service_account_mismatch';
  } else if (/accessnotconfigured|service_disabled|api.*disabled|has not been used|disabled/i.test(combined)) {
    code = 'drive_api_disabled';
  } else if (looksLikeStorageQuotaExceeded(details)) {
    code = driveAuthMode() === 'oauth' ? 'drive_storage_quota' : 'service_account_storage_quota';
  } else if (details.status === 403 || /forbidden|permission|insufficient/i.test(combined)) {
    code = 'permission_denied';
  }

  return {
    driveErrorCode: code,
    driveErrorMessage: driveMessage(code, details),
    driveErrorStatus: details.status,
    driveErrorReason: details.reason,
    googleErrorCode: details.status,
    googleErrorReason: details.reason,
    googleErrorMessage: details.message
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
  const oauth = driveOAuthDiagnostic();
  return {
    driveStorageConfigured: driveStorageConfigured(),
    driveAuthMode: driveAuthMode(),
    oauthClientConfigured: oauth.oauthClientConfigured,
    oauthRefreshTokenConfigured: oauth.oauthRefreshTokenConfigured,
    oauthConfigured: oauth.oauthConfigured,
    oauthClientIdConfigured: oauth.oauthClientIdConfigured,
    oauthClientSecretConfigured: oauth.oauthClientSecretConfigured,
    oauthMissing: oauth.oauthMissing,
    driveStorageWritable: false,
    driveFolderIdPresent: Boolean(config.google.driveFolderId),
    driveFolderAccessible: false,
    configuredFolderId: '',
    serviceAccountEmail: config.google.clientEmail || '',
    serviceAccountSource: config.google.credentialsSource || '',
    serviceAccountJsonPresent: Boolean(config.google.serviceAccountJsonPresent),
    driveErrorCode: '',
    driveErrorMessage: '',
    driveErrorStatus: 0,
    driveErrorReason: '',
    googleErrorCode: 0,
    googleErrorReason: '',
    googleErrorMessage: '',
    folderExists: false,
    folderName: '',
    folderMimeType: '',
    folderCapabilities: {
      canAddChildren: false,
      canEdit: false
    },
    folderSharedWithServiceAccount: false,
    folderPermissionsVisible: false,
    folderOwners: [],
    rootFolderName: '',
    rootFolderMimeType: '',
    rootFolderCanAddChildren: false,
    rootFolderCanEdit: false,
    writeProbeAttempted: false,
    writeProbeFolderCreated: false,
    writeProbeFileCreated: false,
    writeProbeSuccess: false,
    writeProbeFileId: '',
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
  result.googleErrorCode = classified.googleErrorCode || result.driveErrorStatus || 0;
  result.googleErrorReason = classified.googleErrorReason || result.driveErrorReason || '';
  result.googleErrorMessage = classified.googleErrorMessage || result.driveErrorMessage || '';
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
  let fileId = '';
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = await drive.files.create({
      requestBody: {
        name: `brops_drive_write_test_${timestamp}.txt`,
        parents: [config.google.driveFolderId],
        mimeType: textMime
      },
      media: {
        mimeType: textMime,
        body: Readable.from(['BROPS Drive storage write check'])
      },
      fields: 'id,name,parents',
      supportsAllDrives: true
    });
    fileId = file.data.id || '';
    result.writeProbeFileId = fileId;
    result.writeProbeSuccess = Boolean(fileId);
    result.writeProbeFileCreated = result.writeProbeSuccess;
    result.driveStorageWritable = result.writeProbeSuccess;
  } catch (error) {
    applyError(result, error);
  } finally {
    const fileCleaned = await cleanupProbe(drive, fileId);
    result.writeProbeCleanedUp = fileCleaned;
  }
}

function permissionMatchesServiceAccount(permission = {}) {
  const serviceAccountEmail = String(config.google.clientEmail || '').toLowerCase();
  if (!serviceAccountEmail) return false;
  return String(permission.emailAddress || '').toLowerCase() === serviceAccountEmail;
}

function folderOwnerSummary(owners = []) {
  return owners.map((owner) => ({
    displayName: owner.displayName || '',
    emailAddress: owner.emailAddress || '',
    me: Boolean(owner.me)
  }));
}

export async function runDriveStorageDiagnostics({ writeProbe = false, force = false, includeFolderId = false } = {}) {
  if (!force && cachedDiagnostic && Date.now() - cachedDiagnostic.at < cacheTtlMs && (!writeProbe || cachedDiagnostic.writeProbe)) {
    const cached = clone(cachedDiagnostic.value);
    if (includeFolderId) cached.configuredFolderId = config.google.driveFolderId || '';
    return cached;
  }

  const result = baseDiagnostic();
  result.configuredFolderId = includeFolderId ? config.google.driveFolderId || '' : '';
  if (!result.driveFolderIdPresent) return applyError(result, null, { defaultCode: 'folder_id_missing' });
  if (!driveCredentialsConfigured()) {
    return applyError(result, null, {
      defaultCode: config.google.driveOAuthPresent ? 'drive_oauth_missing' : 'google_credentials_missing'
    });
  }

  try {
    const drive = getDriveClient();
    const root = await drive.files.get({
      fileId: config.google.driveFolderId,
      fields: 'id,name,mimeType,capabilities,owners(displayName,emailAddress,me),permissions(id,type,role,emailAddress,displayName,deleted)',
      supportsAllDrives: true
    });
    result.driveFolderAccessible = true;
    result.folderExists = true;
    result.folderName = root.data.name || '';
    result.folderMimeType = root.data.mimeType || '';
    result.folderCapabilities = {
      canAddChildren: Boolean(root.data.capabilities?.canAddChildren),
      canEdit: Boolean(root.data.capabilities?.canEdit)
    };
    result.folderPermissionsVisible = Array.isArray(root.data.permissions);
    result.folderSharedWithServiceAccount = result.folderPermissionsVisible
      ? root.data.permissions.some(permissionMatchesServiceAccount)
      : false;
    result.folderOwners = folderOwnerSummary(root.data.owners || []);
    result.rootFolderName = result.folderName;
    result.rootFolderMimeType = result.folderMimeType;
    result.rootFolderCanAddChildren = result.folderCapabilities.canAddChildren;
    result.rootFolderCanEdit = result.folderCapabilities.canEdit;

    if (result.folderMimeType !== folderMime || result.folderName !== 'BROPS Storage') {
      return applyError(result, null, { defaultCode: result.folderMimeType === folderMime ? 'wrong_folder' : 'not_a_folder' });
    }

    if (!result.folderCapabilities.canAddChildren) {
      return applyError(result, null, { defaultCode: 'cannot_add_children' });
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
