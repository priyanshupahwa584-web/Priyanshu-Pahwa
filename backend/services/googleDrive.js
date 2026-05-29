import fs from 'node:fs';
import { config, driveStorageConfigError } from '../config.js';
import { getDriveClient } from './googleClient.js';

export const driveStorageFolders = ['Metro Uploads', 'Reports', 'Labels', 'Backups'];

function driveFolderId() {
  if (!config.google.driveFolderId) {
    const error = new Error(driveStorageConfigError() || 'GOOGLE_DRIVE_FOLDER_ID is not configured on the server.');
    error.statusCode = 503;
    error.code = 'drive_folder_missing';
    throw error;
  }
  return config.google.driveFolderId;
}

export async function uploadFileToDrive({ filePath, fileName, mimeType, folderName = '' }) {
  const parent = folderName ? await ensureDriveSubfolder(folderName) : { id: driveFolderId() };
  const drive = getDriveClient();
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parent.id]
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath)
    },
    fields: 'id,name,mimeType,size,webViewLink'
  });
  return response.data;
}

export async function ensureDriveSubfolder(folderName) {
  const rootFolderId = driveFolderId();
  const drive = getDriveClient();
  const safeFolderName = String(folderName || '').replace(/[\\/]/g, '-').trim();
  const query = [
    `name = '${safeFolderName.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    `'${rootFolderId}' in parents`,
    'trashed = false'
  ].join(' and ');
  const existing = await drive.files.list({
    q: query,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: 1
  });
  if (existing.data.files?.[0]) return existing.data.files[0];
  const created = await drive.files.create({
    requestBody: {
      name: safeFolderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId]
    },
    fields: 'id,name'
  });
  return created.data;
}

export async function uploadFileToDriveFolder({ filePath, fileName, mimeType, folderName }) {
  return uploadFileToDrive({ filePath, fileName, mimeType, folderName });
}

export async function uploadBufferToDrive({ buffer, fileName, mimeType, folderName = 'Reports' }) {
  const tempPath = `${config.exportDir}/${Date.now()}-${fileName}`;
  fs.writeFileSync(tempPath, buffer);
  try {
    return await uploadFileToDrive({ filePath: tempPath, fileName, mimeType, folderName });
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export async function getDriveDownload(fileId) {
  const drive = getDriveClient();
  return drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
}
