import { Controller, Get, Injectable } from '@nestjs/common';
import { Db, Tx } from './infra';
import { Public, Roles } from './auth';

/** Modul Configuration (TDD 2.6, AD-15): parameter produk dan ambang analitik dari system_settings. */
@Injectable()
export class Settings {
  private cache: { at: number; values: Map<string, any> } | null = null;
  constructor(private db: Db) {}

  async all(c?: Tx): Promise<Map<string, any>> {
    if (!c && this.cache && Date.now() - this.cache.at < 30_000) return this.cache.values;
    const r = await this.db.query('SELECT key, value FROM system_settings', [], c);
    const values = new Map(r.rows.map((x) => [x.key, x.value]));
    if (!c) this.cache = { at: Date.now(), values };
    return values;
  }
  async get<T = any>(key: string, fallback: T, c?: Tx): Promise<T> {
    const v = (await this.all(c)).get(key);
    return (v === undefined || v === null ? fallback : v) as T;
  }
  async analytics(c?: Tx) {
    return {
      minQuestions: Number(await this.get('analytics.min_questions_for_classification', 3, c)),
      strong: Number(await this.get('analytics.strong_threshold', 0.8, c)),
      weak: Number(await this.get('analytics.weak_threshold', 0.5, c)),
      ruleSetVersion: String(await this.get('analytics.rule_set_version', 'pi-rules-2026.11', c)),
      sameScoreDelta: Number(await this.get('progress.same_score_delta', 50, c)),
      sameAccuracyDelta: Number(await this.get('progress.same_accuracy_delta', 0.1, c)),
    };
  }
}

@Controller()
export class SettingsController {
  constructor(private settings: Settings, private db: Db) {}

  /** EP-SET-01 */
  @Public() @Get('settings/public')
  async publicSettings() {
    const a = await this.settings.analytics();
    return { analytics: { minQuestions: a.minQuestions, strong: a.strong, weak: a.weak } };
  }

  /** EP-SET-02 */
  @Roles('EXAM_ADMIN') @Get('admin/settings')
  async list() {
    const r = await this.db.query('SELECT key, value, description, updated_at FROM system_settings ORDER BY key');
    return { data: r.rows.map((x) => ({ key: x.key, value: x.value, description: x.description, updatedAt: x.updated_at })) };
  }
}
