/**
 * Every table that holds a user's own rows, for "export everything" and as the
 * checklist behind "delete account".
 *
 * Deletion itself is one step: removing the auth user cascades through every
 * `user_id ... references auth.users on delete cascade` table, and child tables
 * (set rows, prescriptions, food items, cycles) cascade from their parents.
 * tests/account/user-data-coverage.test.ts reads the migrations and fails when a
 * new table with a user_id is added without being listed here, so a future table
 * (e.g. device data) cannot silently escape export or deletion.
 */
export interface UserDataTable {
  table: string
  /** Column holding the owner's id. user_profiles uses its primary key. */
  userColumn: 'user_id' | 'id'
}

export const USER_DATA_TABLES: UserDataTable[] = [
  { table: 'user_profiles', userColumn: 'id' },
  { table: 'onboarding_capability_profiles', userColumn: 'user_id' },
  { table: 'nutrition_targets', userColumn: 'user_id' },
  { table: 'body_metrics', userColumn: 'user_id' },
  { table: 'body_metric_write_receipts', userColumn: 'user_id' },
  { table: 'recovery_checkins', userColumn: 'user_id' },
  { table: 'workout_logs', userColumn: 'user_id' },
  { table: 'workout_sessions', userColumn: 'user_id' },
  { table: 'exercise_executions', userColumn: 'user_id' },
  { table: 'set_executions', userColumn: 'user_id' },
  { table: 'session_prescriptions', userColumn: 'user_id' },
  { table: 'method_enrollments', userColumn: 'user_id' },
  { table: 'method_actual_change_events', userColumn: 'user_id' },
  { table: 'user_exercise_progression', userColumn: 'user_id' },
  { table: 'food_logs', userColumn: 'user_id' },
  { table: 'user_food_logs', userColumn: 'user_id' },
  { table: 'user_food_memory', userColumn: 'user_id' },
  { table: 'daily_nutrition_summary', userColumn: 'user_id' },
  { table: 'weekly_summary', userColumn: 'user_id' },
  { table: 'ai_plans', userColumn: 'user_id' },
  { table: 'device_daily_metrics', userColumn: 'user_id' },
  { table: 'ai_generated_content', userColumn: 'user_id' },
  { table: 'ai_generations', userColumn: 'user_id' },
  { table: 'ai_feedback', userColumn: 'user_id' },
]

/** Owned rows that are deliberately not exported (still deleted with the account). */
export const NOT_EXPORTED: Record<string, string> = {
  user_features: '内部功能开关，不是用户内容',
  device_connections: '设备授权凭据，绝不导出；用户断开或删除账号时删除',
}
