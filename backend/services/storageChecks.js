import { config, driveStorageConfigError, facilitySourceConfigError, facilitySourceConfigured, googleCredentialsConfigured, googleCredentialsError } from '../config.js';
import { getDriveClient, getSheetsClient } from './googleClient.js';
import { masterOperationsSheet } from './facilityAnalyticsService.js';
import { platformTabNames } from './sheetSchema.js';

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function statusError(error) {
  return String(error?.message || error?.response?.data?.error?.message || 'Check failed.');
}

function baseCheck() {
  return {
    facilitySourceReadable: false,
    platformDataReadable: false,
    platformDataWritable: false,
    driveFolderWritable: false,
    missingPlatformTabs: [...platformTabNames],
    facilitySourceError: '',
    platformDataError: '',
    driveFolderError: ''
  };
}

async function checkFacilitySource(result) {
  if (!facilitySourceConfigured()) {
    result.facilitySourceError = facilitySourceConfigError();
    return;
  }
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.facilitySourceSheetId,
      range: `${quoteSheetName(masterOperationsSheet)}!A4:AH4`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    result.facilitySourceReadable = true;
  } catch (error) {
    result.facilitySourceError = statusError(error);
  }
}

async function checkPlatformData(result) {
  if (!config.google.platformDataSheetId) {
    result.platformDataError = 'PLATFORM_DATA_SHEET_ID is not configured.';
    return;
  }
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.get({
      spreadsheetId: config.google.platformDataSheetId,
      fields: 'sheets(properties(title))'
    });
    const existingTabs = new Set((response.data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
    result.platformDataReadable = true;
    result.missingPlatformTabs = platformTabNames.filter((tabName) => !existingTabs.has(tabName));
  } catch (error) {
    result.platformDataError = statusError(error);
  }

  try {
    const drive = getDriveClient();
    const response = await drive.files.get({
      fileId: config.google.platformDataSheetId,
      fields: 'id,capabilities(canEdit)'
    });
    result.platformDataWritable = Boolean(response.data.capabilities?.canEdit);
  } catch (error) {
    if (!result.platformDataError) result.platformDataError = statusError(error);
  }
}

async function checkDriveFolder(result) {
  if (!config.google.driveFolderId) {
    result.driveFolderError = driveStorageConfigError();
    return;
  }
  try {
    const drive = getDriveClient();
    const response = await drive.files.get({
      fileId: config.google.driveFolderId,
      fields: 'id,mimeType,capabilities(canAddChildren)'
    });
    result.driveFolderWritable = response.data.mimeType === 'application/vnd.google-apps.folder'
      && Boolean(response.data.capabilities?.canAddChildren);
  } catch (error) {
    result.driveFolderError = statusError(error);
  }
}

export async function checkStorage() {
  const result = baseCheck();
  if (!googleCredentialsConfigured()) {
    const error = googleCredentialsError();
    result.facilitySourceError = error;
    result.platformDataError = error;
    result.driveFolderError = error;
    return result;
  }
  await Promise.all([
    checkFacilitySource(result),
    checkPlatformData(result),
    checkDriveFolder(result)
  ]);
  return result;
}
