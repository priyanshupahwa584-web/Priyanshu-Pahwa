import { google } from 'googleapis';
import { config, googleConfigured } from '../config.js';

const scopes = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
];

let cachedAuth;

export function getGoogleAuth() {
  if (!googleConfigured()) {
    const error = new Error('Google Sheets/Drive credentials are not configured on the server.');
    error.statusCode = 503;
    throw error;
  }
  if (!cachedAuth) {
    cachedAuth = new google.auth.JWT({
      email: config.google.clientEmail,
      key: config.google.privateKey,
      scopes,
      projectId: config.google.projectId || undefined
    });
  }
  return cachedAuth;
}

export function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
}

export function getDriveClient() {
  return google.drive({ version: 'v3', auth: getGoogleAuth() });
}
