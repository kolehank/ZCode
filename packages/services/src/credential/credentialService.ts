import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, backupCorruptFile, withFileLock } from "@zcode/shared/node";
import {
  credentialKeySchema,
  credentialRecordSchema,
  credentialValueSchema,
  formatZodError,
} from "@zcode/shared";
import type { ICredentialService } from "./credential.js";
import {
  createCredentialCipherProvider,
  type CredentialCipherProvider,
} from "./providers/credentialCipherProvider.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";

/**
 * 凭据存储路径
 *
 * 当前持久化格式仍是 JSON，value 在写入前用主密钥加密（enc:v1:），读取时自动解密。
 * 主密钥优先级：ZCODE_CREDENTIAL_SECRET > OS keychain 随机主密钥（见
 * @zcode/shared/node 的 resolveCredentialMasterKey）；旧版本本机推导密钥的密文
 * 会在读取时经 legacy 路径解密并 fire-and-forget 重加密迁移。
 */
const logger = createServiceLogger("credentialService");

function getCredentialsDir() {
  return getAppConfigDir();
}

function getCredentialsFile() {
  return join(getCredentialsDir(), "credentials.json");
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function readAll(credentialsFile = getCredentialsFile()): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(credentialsFile, "utf-8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {};
    }
    throw new Error(`Unable to read ZCode credentials: ${credentialsFile}`, { cause: error });
  }

  try {
    const rawValue = JSON.parse(raw);
    const result = credentialRecordSchema.safeParse(rawValue);
    if (!result.success) {
      throw new Error(formatZodError(result.error));
    }
    return result.data;
  } catch (error) {
    // 把损坏 JSON/schema 当成空 store 后继续 save 会清空其他 OAuth 与登录凭据。
    // 保留损坏文件证据并向上传递错误，禁止自动覆盖。
    const backupPath = await backupCorruptFile(credentialsFile).catch(() => undefined);
    // 服务层日志必须统一经过分级 logger，确保生产环境的损坏凭据告警
    // 进入相同的落盘/采集策略，同时不记录凭据内容。
    logger.warn(undefined, "read failed; refusing to overwrite corrupt credential store", {
      backupPath,
      credentialsFile,
    });
    throw new Error(`ZCode credentials are corrupt: ${credentialsFile}`, { cause: error });
  }
}

async function writeAll(credentialsFile: string, data: Record<string, string>): Promise<void> {
  // 凭据路径之前在模块加载时就绑定到 homedir()，
  // Windows 测试里即使切换 HOME 也会继续写真实用户目录，导致隔离失效。
  await atomicWritePrivateTextFile(credentialsFile, `${JSON.stringify(data, null, 2)}\n`);
}

interface CredentialServiceDependencies {
  cipherProvider?: CredentialCipherProvider;
  /** Host 私有的持久化成功通知；不进入 Renderer/RPC 凭据接口。 */
  onDidMutate?: (event: { operation: "save" | "delete"; key: string }) => void;
}

export function createCredentialService(
  dependencies: CredentialServiceDependencies = {},
): ICredentialService {
  // legacy 迁移：旧本机推导密钥解密成功后 fire-and-forget 重加密写回。
  // 仅当文件中的原值仍是刚解密的旧密文时才改写，避免与并发 delete/save 竞争复活凭据；
  // 迁移失败静默，读取路径不受影响。
  const migrateLegacyValue = dependencies.cipherProvider
    ? undefined
    : (credentialKey: string, plaintext: string, legacyEncryptedValue: string): void => {
        void (async () => {
          const credentialsFile = getCredentialsFile();
          await withFileLock(credentialsFile, async () => {
            const creds = await readAll(credentialsFile);
            if (creds[credentialKey] !== legacyEncryptedValue) {
              return;
            }
            creds[credentialKey] = await cipherProvider.encrypt(plaintext);
            await writeAll(credentialsFile, creds);
          });
        })().catch(() => undefined);
      };

  const cipherProvider =
    dependencies.cipherProvider ??
    createCredentialCipherProvider({ onLegacyValueMigrated: migrateLegacyValue });

  return {
    async load(key: string): Promise<string | null> {
      const validatedKey = credentialKeySchema.parse(key);
      const creds = await readAll();
      const rawValue = creds[validatedKey];
      if (rawValue === undefined) {
        return null;
      }

      return cipherProvider.decrypt(rawValue, validatedKey);
    },

    async save(key: string, value: string): Promise<void> {
      const validatedKey = credentialKeySchema.parse(key);
      const validatedValue = credentialValueSchema.parse(value);
      const encryptedValue = await cipherProvider.encrypt(validatedValue);
      const credentialsFile = getCredentialsFile();
      // desktop host 与 CLI adapter 是独立进程，进程内排队不能阻止 whole-file
      // read-modify-write 丢更新；共享目录锁必须覆盖读取、变更和原子替换全过程。
      await withFileLock(credentialsFile, async () => {
        const creds = await readAll(credentialsFile);
        creds[validatedKey] = encryptedValue;
        await writeAll(credentialsFile, creds);
      });
      dependencies.onDidMutate?.({ operation: "save", key: validatedKey });
    },

    async delete(key: string): Promise<void> {
      const validatedKey = credentialKeySchema.parse(key);
      const credentialsFile = getCredentialsFile();
      await withFileLock(credentialsFile, async () => {
        const creds = await readAll(credentialsFile);
        delete creds[validatedKey];
        await writeAll(credentialsFile, creds);
      });
      dependencies.onDidMutate?.({ operation: "delete", key: validatedKey });
    },
  };
}
