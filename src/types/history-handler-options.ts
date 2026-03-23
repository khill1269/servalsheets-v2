import type { drive_v3, sheets_v4 } from 'googleapis';
import type { SnapshotService } from '../services/snapshot.js';
import type { ElicitationServer } from '../mcp/elicitation.js';
import type { SamplingServer } from '../mcp/sampling.js';
import type { GoogleApiClient } from '../services/google-api.js';
import type { SessionContextManager } from '../services/session-context.js';

export interface HistoryHandlerOptions {
  snapshotService?: SnapshotService;
  driveApi?: drive_v3.Drive;
  sheetsApi?: sheets_v4.Sheets;
  server?: ElicitationServer;
  taskStore?: import('../core/task-store-adapter.js').TaskStoreAdapter;
  samplingServer?: SamplingServer;
  googleClient?: GoogleApiClient;
  sessionContext?: SessionContextManager;
}
