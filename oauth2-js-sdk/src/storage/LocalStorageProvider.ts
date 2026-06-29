import type { IStorageProvider } from './interface';

/**
 * localStorage 存储提供者（默认）
 * 数据持久化，页面刷新后依然保留，跨标签页共享
 */
export class LocalStorageProvider implements IStorageProvider {
  async get(key: string): Promise<unknown> {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async put(key: string, value: unknown): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}
