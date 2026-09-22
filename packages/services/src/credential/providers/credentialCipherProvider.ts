import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { homedir, platform, userInfo } from "node:os";
import { CREDENTIAL_DECRYPT_ERROR_CODE, CREDENTIAL_DECRYPT_ERROR_PREFIX } from "@zcode/shared";
import { resolveCredentialMasterKey } from "@zcode/shared/node";

const ENCRYPTED_VALUE_PREFIX = "enc:v1:";
const CREDENTIAL_CIPHER_ALGORITHM = "aes-256-gcm";
const CREDENTIAL_CIPHER_IV_BYTES = 12;
const CREDENTIAL_CIPHER_AUTH_TAG_BYTES = 16;

export interface CredentialCipherProvider {
  encrypt(value: string): Promise<string>;
  /**
   * @param credentialKey 凭据条目 key，仅用于 legacy 迁移回调定位写回条目；不影响解密本身。
   */
  decrypt(value: string, credentialKey?: string): Promise<string>;
}

/**
 * legacy 迁移回调：旧密文用本机推导密钥解密成功后触发（fire-and-forget）。
 * 由宿主复用既有 save 原子写与文件锁完成重加密落盘；宿主需自行做并发防护
 * （如对比原密文未变才改写）。
 */
export type OnLegacyValueMigrated = (
  credentialKey: string,
  plaintext: string,
  legacyEncryptedValue: string,
) => void;

interface CredentialCipherProviderOptions {
  env?: NodeJS.ProcessEnv;
  onLegacyValueMigrated?: OnLegacyValueMigrated;
}

/**
 * legacy：旧版本（BYOK P2 之前）用本机信息（platform/homedir/username）推导加密密钥。
 * 仅保留给历史密文的 decrypt 迁移重试，绝不用于 encrypt；新密文一律由
 * resolveCredentialMasterKey（env secret 或 OS keychain）提供密钥。
 */
function deriveLegacyCipherKey(): Buffer {
  let username = "unknown";
  try {
    username = userInfo().username;
  } catch {
    // 部分运行环境可能拿不到系统用户，失败时退回默认占位值。
  }

  return createHash("sha256")
    .update(`zcode-credential-fallback:${platform()}:${homedir()}:${username}`)
    .digest();
}

interface DecryptedPayload {
  iv: Buffer;
  authTag: Buffer;
  cipherText: Buffer;
}

function base64urlToBuffer(raw: string): Buffer {
  return Buffer.from(raw, "base64url");
}

function bufferToBase64url(raw: Buffer): string {
  return raw.toString("base64url");
}

function createCredentialDecryptError(
  reason: string,
): Error & { code: typeof CREDENTIAL_DECRYPT_ERROR_CODE } {
  return Object.assign(new Error(`${CREDENTIAL_DECRYPT_ERROR_PREFIX}${reason}`), {
    code: CREDENTIAL_DECRYPT_ERROR_CODE,
  });
}

function parseEncryptedPayload(value: string): DecryptedPayload {
  const payload = value.slice(ENCRYPTED_VALUE_PREFIX.length);
  const parts = payload.split(".");
  const [ivRaw, authTagRaw, cipherRaw] = parts;

  if (!ivRaw || !authTagRaw || !cipherRaw || parts.length !== 3) {
    throw createCredentialDecryptError("密文格式非法");
  }

  const iv = base64urlToBuffer(ivRaw);
  const authTag = base64urlToBuffer(authTagRaw);
  const cipherText = base64urlToBuffer(cipherRaw);

  if (iv.length !== CREDENTIAL_CIPHER_IV_BYTES) {
    throw createCredentialDecryptError("IV 长度非法");
  }

  if (authTag.length !== CREDENTIAL_CIPHER_AUTH_TAG_BYTES) {
    throw createCredentialDecryptError("AuthTag 长度非法");
  }

  return { iv, authTag, cipherText };
}

function aesGcmDecrypt(key: Buffer, payload: DecryptedPayload): string {
  const decipher = createDecipheriv(CREDENTIAL_CIPHER_ALGORITHM, key, payload.iv);
  decipher.setAuthTag(payload.authTag);

  let plainText: Buffer | undefined;
  try {
    plainText = Buffer.concat([decipher.update(payload.cipherText), decipher.final()]);
    return plainText.toString("utf-8");
  } catch {
    throw createCredentialDecryptError("密钥不匹配或密文已损坏");
  } finally {
    // 中间明文 Buffer 用后清零，缩短明文在内存中的残留窗口。
    plainText?.fill(0);
  }
}

function aesGcmEncrypt(key: Buffer, value: string): string {
  const iv = randomBytes(CREDENTIAL_CIPHER_IV_BYTES);
  const cipher = createCipheriv(CREDENTIAL_CIPHER_ALGORITHM, key, iv);
  let encrypted: Buffer | undefined;
  try {
    encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      ENCRYPTED_VALUE_PREFIX,
      bufferToBase64url(iv),
      ".",
      bufferToBase64url(authTag),
      ".",
      bufferToBase64url(encrypted),
    ].join("");
  } finally {
    // 中间密文 Buffer 用后清零（密钥可能来自共享缓存，这里不做清零）。
    encrypted?.fill(0);
  }
}

export function createCredentialCipherProvider(
  options: CredentialCipherProviderOptions = {},
): CredentialCipherProvider {
  const env = options.env ?? process.env;
  const onLegacyValueMigrated = options.onLegacyValueMigrated;

  return {
    async encrypt(value: string): Promise<string> {
      const key = await resolveCredentialMasterKey(env);
      return aesGcmEncrypt(key, value);
    },

    async decrypt(value: string, credentialKey?: string): Promise<string> {
      if (!value.startsWith(ENCRYPTED_VALUE_PREFIX)) {
        return value;
      }

      // 先校验格式再解析密钥，非法格式无需触发 keychain 子进程。
      const payload = parseEncryptedPayload(value);
      const key = await resolveCredentialMasterKey(env);

      try {
        return aesGcmDecrypt(key, payload);
      } catch {
        // 新密钥解密失败：可能是旧版本（本机推导密钥）写入的历史密文，
        // 用 legacy key 再试一次；成功则返回明文并触发 fire-and-forget 重加密迁移。
        try {
          const legacyKey = deriveLegacyCipherKey();
          const plaintext = aesGcmDecrypt(legacyKey, payload);
          if (onLegacyValueMigrated && credentialKey !== undefined) {
            try {
              onLegacyValueMigrated(credentialKey, plaintext, value);
            } catch {
              // 迁移回调失败静默：读取路径不能因写回失败而中断。
            }
          }
          return plaintext;
        } catch {
          throw createCredentialDecryptError("密钥不匹配或密文已损坏");
        }
      }
    },
  };
}
