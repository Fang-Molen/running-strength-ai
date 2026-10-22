export type Provider = 'apple_health' | 'health_connect'
export interface NativeStatus {
  provider: Provider
  state: 'available' | 'provider_unavailable' | 'permissions_required'
  message: string
}
export interface FangkunHealthPlugin {
  checkAvailability(options: { provider: Provider }): Promise<NativeStatus>
  requestReadPermissions(options: { provider: Provider }): Promise<NativeStatus>
  /** Versioned raw JSON. Normalize and validate it before showing a confirmation UI. */
  readRecords(options: { provider: Provider; from: string; to: string }): Promise<unknown>
}
export declare const FangkunHealth: FangkunHealthPlugin
