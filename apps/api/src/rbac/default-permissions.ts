export const DEFAULT_PERMISSION_KEYS = [
  'enquiries.create',
  'enquiries.read',
  'enquiries.read_all',
  'enquiries.update',
  'enquiries.assign',
  'enquiries.convert',
  'enquiries.close',
  'enquiries.delete',
] as const;

export type DefaultPermissionKey =
  (typeof DEFAULT_PERMISSION_KEYS)[number];