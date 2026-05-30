import { google } from 'googleapis';
import { config, facilitySourceConfigError, facilitySourceConfigured, googleCredentialsConfigured, googleCredentialsError } from '../config.js';

const scopes = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive'
];

let cachedAuth;

export function getGoogleAuth() {
  if (!googleCredentialsConfigured()) {
    const error = new Error(googleCredentialsError() || 'Google service account credentials are not configured on the server.');
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
  if (!facilitySourceConfigured()) {
    const error = new Error(facilitySourceConfigError());
    error.statusCode = 503;
    throw error;
  }
  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
}

export function getDriveClient() {
  return google.drive({ version: 'v3', auth: getGoogleAuth() });
}
