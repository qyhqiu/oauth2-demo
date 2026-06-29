import type { IStorageProvider } from './interface';

/**
 * 内存存储提供者（降级方案）
 * 用于浏览器不支持 localStorage/sessionStorage 时的降级处理，数据仅存在于当前页面生命周期内
 */
export class InMemoryStorageProvider implements IStorageProvider {
  private readonly store = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
