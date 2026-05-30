import { google } from 'googleapis';
import {
  config,
  driveAuthMode as configuredDriveAuthMode,
  driveCredentialsError,
  driveOAuthConfigured,
  facilitySourceConfigError,
  facilitySourceConfigured,
  googleCredentialsConfigured,
  googleCredentialsError
} from '../config.js';

const scopes = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive'
];

let cachedAuth;
let cachedDriveOAuthAuth;

function configError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

export function getGoogleAuth() {
  if (!googleCredentialsConfigured()) {
    throw configError(googleCredentialsError() || 'Google service account credentials are not configured on the server.');
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

export function getDriveAuthMode() {
  return configuredDriveAuthMode();
}

export function getDriveAuth() {
  if (getDriveAuthMode() === 'oauth') {
    if (!driveOAuthConfigured()) {
      throw configError(driveCredentialsError() || 'Google Drive OAuth credentials are not configured on the server.');
    }
    if (!cachedDriveOAuthAuth) {
      cachedDriveOAuthAuth = new google.auth.OAuth2(
        config.google.driveOAuthClientId,
        config.google.driveOAuthClientSecret
      );
      cachedDriveOAuthAuth.setCredentials({ refresh_token: config.google.driveOAuthRefreshToken });
    }
    return cachedDriveOAuthAuth;
  }
  return getGoogleAuth();
}

export function getSheetsClient() {
  if (!facilitySourceConfigured()) {
    throw configError(facilitySourceConfigError());
  }
  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
}

export function getDriveClient() {
  return google.drive({ version: 'v3', auth: getDriveAuth() });
}
