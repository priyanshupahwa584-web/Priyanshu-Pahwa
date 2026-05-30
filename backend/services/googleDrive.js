import fs from 'node:fs';
import { config } from '../config.js';
import { getDriveClient } from './googleClient.js';
import { createDriveStorageError } from './driveDiagnostics.js';

export function driveStorageRequiredError() {
  if (!config.google.driveFolderId) {
    return createDriveStorageError(null, { defaultCode: 'folder_id_missing' });
  }
  return null;
}

function driveOptions(extra = {}) {
  return { supportsAllDrives: true, ...extra };
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findChild({ parentId, name, mimeType }) {
  const drive = getDriveClient();
  const parts = [
    `name = '${escapeDriveQuery(name)}'`,
    `'${escapeDriveQuery(parentId)}' in parents`,
    'trashed = false'
  ];
  if (mimeType) parts.push(`mimeType = '${escapeDriveQuery(mimeType)}'`);
  const existing = await drive.files.list(driveOptions({
    q: parts.join(' and '),
    fields: 'files(id,name,mimeType,size,webViewLink,capabilities(canAddChildren,canEdit))',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    pageSize: 1
  }));
  return existing.data.files?.[0] || null;
}

export async function ensureDriveFolderPath(pathParts = []) {
  const configError = driveStorageRequiredError();
  if (configError) throw configError;
  const drive = getDriveClient();
  let parentId = config.google.driveFolderId;
  let current = null;
  for (const part of pathParts) {
    const safeFolderName = String(part || '').replace(/[\\/]/g, '-').trim();
    if (!safeFolderName) continue;
    current = await findChild({ parentId, name: safeFolderName, mimeType: 'application/vnd.google-apps.folder' });
    if (!current) {
      const created = await drive.files.create(driveOptions({
        requestBody: {
          name: safeFolderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId]
        },
        fields: 'id,name,mimeType,webViewLink,capabilities(canAddChildren,canEdit)'
      }));
      current = created.data;
    }
    parentId = current.id;
  }
  return current || { id: parentId, name: 'BROPS Storage' };
}

export async function uploadFileToDrive({ filePath, fileName, mimeType, folderId = config.google.driveFolderId, folderPath = [] }) {
  const configError = driveStorageRequiredError();
  if (configError) throw configError;
  const targetFolder = folderPath.length ? await ensureDriveFolderPath(folderPath) : { id: folderId };
  const drive = getDriveClient();
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [targetFolder.id]
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath)
    },
    fields: 'id,name,mimeType,size,webViewLink',
    supportsAllDrives: true
  });
  return response.data;
}

export async function ensureDriveSubfolder(folderName) {
  return ensureDriveFolderPath([folderName]);
}

export async function uploadFileToDriveFolder({ filePath, fileName, mimeType, folderName }) {
  return uploadFileToDrive({ filePath, fileName, mimeType, folderPath: [folderName] });
}

export async function uploadBufferToDrive({ buffer, fileName, mimeType, folderPath = ['Reports'] }) {
  const tempPath = `${config.exportDir}/${Date.now()}-${fileName}`;
  fs.writeFileSync(tempPath, buffer);
  try {
    return await uploadFileToDrive({ filePath: tempPath, fileName, mimeType, folderPath });
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export async function getDriveDownload(fileId) {
  const drive = getDriveClient();
  return drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
}
