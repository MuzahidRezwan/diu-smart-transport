/**
 * Everything a request handler needs, passed explicitly so tests can swap
 * any external system (SSO, directory, payment gateway, ML, push) for a fake.
 */
import type { Config } from './config.js';
import type { DB } from './db/client.js';
import type { SsoProvider, UniversityDirectory } from './auth/providers.js';
import type { PaymentGateway } from './modules/payments/gateway.js';
import type { MlClient } from './modules/predictions/ml-client.js';
import type { PushSender } from './notifications/push.js';

export interface Realtime {
  /** Sends an event to everyone in a room (e.g. "route:<id>", "authority"). */
  emit(room: string, event: string, data: unknown): void;
}

export interface AppContext {
  config: Config;
  /** Rider-facing database connection. */
  db: DB;
  /** Authority-facing connection: in production a role without access to user_profiles. */
  adminDb: DB;
  sso: SsoProvider;
  directory: UniversityDirectory;
  gateway: PaymentGateway;
  ml: MlClient;
  push: PushSender;
  realtime: Realtime;
}

export const noopRealtime: Realtime = { emit: () => undefined };
