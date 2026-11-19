/**
 * Permission catalogue for authority accounts.
 *
 * Privacy boundary: there is deliberately NO permission to read rider profiles,
 * edit rider accounts or act as a rider. Because the main admin can only grant
 * permissions that exist here, nobody can be given that access from the dashboard.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  PREDICTIONS_VIEW: 'predictions.view',
  PREDICTIONS_RUN: 'predictions.run',
  ALLOCATION_MANAGE: 'allocation.manage',
  ALLOCATION_PUBLISH: 'allocation.publish',
  FLEET_VIEW: 'fleet.view',
  FLEET_MANAGE: 'fleet.manage',
  ROUTES_MANAGE: 'routes.manage',
  ROUTINES_MANAGE: 'routines.manage',
  CARDS_APPROVE: 'cards.approve',
  CARDS_GRANT_FREE: 'cards.grant_free',
  DAYPASS_APPROVE: 'daypass.approve',
  ACCESS_LOOKUP: 'access.lookup',
  ACCESS_GRANT_REVOKE: 'access.grant_revoke',
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_EXPORT: 'payments.export',
  PAYMENTS_REFUND: 'payments.refund',
  FEES_MANAGE: 'fees.manage',
  SEMESTERS_MANAGE: 'semesters.manage',
  NOTICES_PUBLISH: 'notices.publish',
  SUPPORT_MANAGE: 'support.manage',
  TRACKING_VIEW: 'tracking.view',
  REPORTS_VIEW: 'reports.view',
  AUDIT_VIEW: 'audit.view',
  SETTINGS_MANAGE: 'settings.manage',
  ADMINS_MANAGE: 'admins.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.view': 'See the dashboard',
  'predictions.view': 'See demand predictions',
  'predictions.run': 'Re-run predictions',
  'allocation.manage': 'Create and edit bus allocations',
  'allocation.publish': 'Publish allocations to riders',
  'fleet.view': 'See buses and availability',
  'fleet.manage': 'Add, edit and retire buses',
  'routes.manage': 'Manage routes, stops and time slots',
  'routines.manage': 'Review and activate class routines',
  'cards.approve': 'Approve or reject card requests',
  'cards.grant_free': 'Approve cards without payment',
  'daypass.approve': 'Approve day passes over the limit',
  'access.lookup': "Look up a rider's transport access by full ID",
  'access.grant_revoke': 'Give or revoke transport access',
  'payments.view': 'See payments and collection',
  'payments.export': 'Download payment reports',
  'payments.refund': 'Refund payments',
  'fees.manage': 'Set fee rules',
  'semesters.manage': 'Manage semesters and calendar',
  'notices.publish': 'Publish notices and push notifications',
  'support.manage': 'Answer complaints and help requests',
  'tracking.view': 'See live bus locations',
  'reports.view': 'See reports',
  'audit.view': 'See the audit log',
  'settings.manage': 'Change system settings',
  'admins.manage': 'Add and remove co-admins',
};

/** Ready-made permission sets the main admin can start from. */
export const PERMISSION_PRESETS: Record<string, readonly Permission[]> = {
  'Allocation officer': [
    'dashboard.view', 'predictions.view', 'predictions.run', 'allocation.manage', 'allocation.publish', 'fleet.view', 'tracking.view',
  ],
  'Card desk': ['dashboard.view', 'cards.approve', 'daypass.approve', 'access.lookup', 'payments.view'],
  'Finance': ['dashboard.view', 'payments.view', 'payments.export', 'payments.refund', 'fees.manage', 'reports.view'],
  'Support desk': ['dashboard.view', 'support.manage', 'notices.publish', 'tracking.view'],
  Viewer: ['dashboard.view', 'predictions.view', 'fleet.view', 'tracking.view', 'reports.view'],
};

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/** Main admins hold every permission; co-admins hold exactly what they were given. */
export function hasPermission(
  account: { isMainAdmin: boolean; permissions: readonly string[] },
  needed: Permission,
): boolean {
  return account.isMainAdmin || account.permissions.includes(needed);
}
