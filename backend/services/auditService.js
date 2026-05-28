import { appendRows } from './googleSheets.js';
import { tabs } from './sheetSchema.js';
import { id, nowIso } from '../utils/ids.js';

export async function audit({ actor = 'system', action, entity, entityId = '', ip = '', device = '', metadata = {} }) {
  try {
    await appendRows(tabs.audit, [{
      id: id('audit'),
      actor,
      action,
      entity,
      entityId,
      ip,
      device,
      metadata: JSON.stringify(metadata || {}),
      createdAt: nowIso()
    }]);
  } catch (error) {
    if (error?.statusCode === 503 && String(error.message || '').includes('credentials are not configured')) return;
    console.error('Audit log failed:', error.message);
  }
}
