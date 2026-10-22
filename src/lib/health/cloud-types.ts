import type { DeviceActivity, DeviceHealthRow } from '../ui/device-parse'

/** Cloud identities are vendor-derived references, never local athlete identifiers. */
export type CloudProvider = 'polar' | 'suunto' | 'huawei'
export type CloudStatus = { provider: CloudProvider; configured: boolean; connected: boolean; accountRef: string | null; reason?: string }
export type CloudPreview = { provider: CloudProvider; accountRef: string; fetchedAt: string; activities: DeviceActivity[]; health: DeviceHealthRow[]; issues: string[]; partial: boolean }
export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['polar', 'suunto', 'huawei']
