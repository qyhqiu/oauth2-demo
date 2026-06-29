/**
 * Storage Provider 接口定义（参考 authing-js-sdk StorageProvider 设计）
 *
 * 所有存储提供者必须实现以下接口，确保可以灵活替换底层存储策略。
 */
export interface IStorageProvider {
  /** 获取存储的值 */
  get(key: string): Promise<unknown>;
  /** 存储键值对 */
  put(key: string, value: unknown): Promise<void>;
  /** 删除键 */
  delete(key: string): Promise<void>;
}
