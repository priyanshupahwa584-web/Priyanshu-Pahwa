import fs from 'node:fs';
import { config } from '../config.js';
import { getDriveClient } from './googleClient.js';

export async function uploadFileToDrive({ filePath, fileName, mimeType }) {
  if (!config.google.driveFolderId) {
    const error = new Error('GOOGLE_DRIVE_FOLDER_ID is not configured on the server.');
    error.statusCode = 503;
    throw error;
  }
  const drive = getDriveClient();
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [config.google.driveFolderId]
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
  if (!config.google.driveFolderId) {
    const error = new Error('GOOGLE_DRIVE_FOLDER_ID is not configured on the server.');
    error.statusCode = 503;
    throw error;
  }
  const drive = getDriveClient();
  const safeFolderName = String(folderName || '').replace(/[\\/]/g, '-').trim();
  const query = [
    `name = '${safeFolderName.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    `'${config.google.driveFolderId}' in parents`,
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
      parents: [config.google.driveFolderId]
    },
    fields: 'id,name'
  });
  return created.data;
}

export async function uploadFileToDriveFolder({ filePath, fileName, mimeType, folderName }) {
  const folder = await ensureDriveSubfolder(folderName);
  const drive = getDriveClient();
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folder.id]
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath)
    },
    fields: 'id,name,mimeType,size,webViewLink'
  });
  return response.data;
}

export async function uploadBufferToDrive({ buffer, fileName, mimeType }) {
  const tempPath = `${config.exportDir}/${Date.now()}-${fileName}`;
  fs.writeFileSync(tempPath, buffer);
  try {
    return await uploadFileToDrive({ filePath: tempPath, fileName, mimeType });
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export async function getDriveDownload(fileId) {
  const drive = getDriveClient();
  return drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
}
