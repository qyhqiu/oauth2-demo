import type { IStorageProvider } from './interface';

/**
 * sessionStorage 存储提供者
 * 仅当前标签页有效，关闭标签页后清除，适合存储 PKCE 流程中的临时数据
 */
export class SessionStorageProvider implements IStorageProvider {
  async get(key: string): Promise<unknown> {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async put(key: string, value: unknown): Promise<void> {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    sessionStorage.removeItem(key);
  }
}
