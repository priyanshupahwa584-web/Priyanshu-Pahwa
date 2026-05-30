process.env.JWT_SECRET = 'local-verify-secret-change-in-production';
process.env.ADMIN_USERNAME = 'Priyanshu';
process.env.ADMIN_PASSWORD_HASH = '$2b$12$VTUqGFUrsEhngu40BrKL/OCBC7Y0DyirENW464/9FCZPMej6pxrFe';
process.env.NODE_ENV = 'test';
[
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_PROJECT_ID',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_SHEET_ID',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_DRIVE_OAUTH_CLIENT_ID',
  'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET',
  'GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN'
].forEach((key) => {
  delete process.env[key];
});

const { app } = await import('../server.js');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await listen();
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/api`;

try {
  let result = await request(baseUrl, '/health');
  assert(result.response.status === 200, 'health endpoint failed');
  assert(result.body.adminAuth?.configured === true, 'health endpoint should report admin auth configured');
  assert(result.body.adminAuth?.passwordHashConfigured === true, 'health endpoint should report admin hash configured');
  assert(result.body.googleConfigured === false, 'health endpoint should report missing Google config in local verify');
  assert(result.body.driveFolderIdPresent === false, 'health endpoint should report missing Drive folder ID in local verify');
  assert(result.body.driveAuthMode === 'service_account', 'health endpoint should default Drive auth mode to service_account');
  assert(result.body.oauthClientConfigured === false, 'health endpoint should report missing OAuth Drive client in local verify');
  assert(result.body.oauthRefreshTokenConfigured === false, 'health endpoint should report missing OAuth Drive refresh token in local verify');
  assert(result.body.driveFolderAccessible === false, 'health endpoint should report Drive folder inaccessible without folder ID');
  assert(result.body.serviceAccountEmail === '', 'health endpoint should not invent a service account email');
  assert(result.body.driveErrorCode === 'folder_id_missing', 'health endpoint should report exact missing Drive folder ID code');
  assert(result.body.facilitySourceReadable === false, 'health endpoint should report Facility Sort source unreadable without Google config');
  assert(result.body.driveStorageConfigured === false, 'health endpoint should report missing Drive Excel storage in local verify');
  assert(result.body.driveStorageWritable === false, 'health endpoint should report Drive Excel storage unwritable without Google config');

  result = await request(baseUrl, '/auth/me');
  assert(result.response.status === 401, 'unauthenticated auth/me should return 401');
  assert(result.body.authenticated === false, 'auth/me should report authenticated=false');
  assert(result.body.sessionPresent === false, 'auth/me should report sessionPresent=false');

  result = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'Priyanshu', password: 'wrong' })
  });
  assert(result.response.status === 401, 'invalid login should return 401');
  assert(/Invalid username or password/i.test(result.body.message), 'invalid login message should be clear');

  result = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'Priyanshu', password: '7518' })
  });
  assert(result.response.status === 200, 'valid login failed');
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0] || '';
  assert(cookie, 'valid login did not set session cookie');
  assert(result.body.accessToken, 'valid login did not return fallback access token');
  assert(result.body.accessTokenExpiresAt, 'valid login did not return fallback token expiry');

  result = await request(baseUrl, '/auth/me', { headers: { authorization: `Bearer ${result.body.accessToken}` } });
  assert(result.response.status === 200, 'auth/me bearer fallback failed');
  assert(result.body.authenticated === true, 'auth/me should report authenticated=true');
  assert(result.body.sessionPresent === true, 'auth/me should report sessionPresent=true');

  result = await request(baseUrl, '/auth/security', { headers: { cookie } });
  assert(result.response.status === 200, 'security profile route failed');
  assert(Array.isArray(result.body.sessions), 'security profile should include sessions');

  result = await request(baseUrl, '/system/drive-check', { headers: { cookie } });
  assert(result.response.status === 503, 'drive check should report missing Drive config in local verify');
  assert(result.body.driveErrorCode === 'folder_id_missing', 'drive check should return exact missing Drive folder ID code');
  assert(result.body.configuredFolderId === '', 'drive check should show no configured folder ID in local verify');

  result = await request(baseUrl, '/data', { headers: { cookie } });
  assert(result.response.status === 503, 'missing Google config should return 503 for data route');
  assert(/credentials are not configured/i.test(result.body.message), 'missing Google config message should be clear');

  result = await request(baseUrl, '/facility-intelligence', { headers: { cookie } });
  assert(result.response.status === 503, 'Facility Intelligence route should exist and report missing Google config');

  result = await request(baseUrl, '/labels/print/test', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ printerName: 'Verify Printer', type: 'zpl' })
  });
  assert(result.response.status === 200, 'label print test route failed');
  assert(String(result.body.zpl || '').includes('^XA'), 'label test should generate ZPL');

  result = await request(baseUrl, '/labels', { headers: { cookie } });
  assert(result.response.status === 503, 'Metro Labeling route should exist and report missing Google config');

  result = await request(baseUrl, '/metro-labeling', { headers: { cookie } });
  assert(result.response.status === 503, 'Metro Labeling production route should exist and report missing Google config');

  result = await request(baseUrl, '/metro-labeling/history', { headers: { cookie } });
  assert(result.response.status === 503, 'Metro Labeling history route should exist and report missing Google config');

  result = await request(baseUrl, '/metro-labeling/scan', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ trackingNumber: 'VERIFY-TRACKING' })
  });
  assert(result.response.status === 503, 'Metro scan route should exist and report missing Google config');

  result = await request(baseUrl, '/users', { headers: { cookie } });
  assert(result.response.status === 503, 'Users route should exist and report missing Google config');

  result = await request(baseUrl, '/fulfilment/report', { headers: { cookie } });
  assert(result.response.status === 503, 'Fulfilment report route should exist and report missing Google config');

  result = await request(baseUrl, '/exports', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ format: 'csv', filters: {} })
  });
  assert(result.response.status === 503, 'export route should exist and report missing Google config');

  console.log('Local verification passed.');
} finally {
  server.close();
}
