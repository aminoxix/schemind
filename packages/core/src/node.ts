/**
 * `schemind/node` — server-side entry point.
 *
 * Houses storage drivers meant for backend use: {@link LocalStorageDriver}
 * (depends on `node:fs`) and the "bring your own client" {@link RedisStorageDriver}
 * / {@link S3StorageDriver}. Kept separate from the `.` entry so browser/edge
 * bundles of `schemind` never pull in `node:fs`.
 */
export { LocalStorageDriver } from './storage/local.js'
export {
  RedisStorageDriver,
  type RedisLike,
  type RedisStorageOptions,
} from './storage/redis.js'
export { S3StorageDriver, type S3Like, type S3StorageOptions } from './storage/s3.js'
export { startDashboard, type DashboardHandle, type DashboardOptions } from './dashboard.js'
