import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { homedir, platform, userInfo } from "node:os";
import { resolveCredentialMasterKey } from "@zcode/shared/node";

const ENCRYPTED_VALUE_PREFIX = "enc:v1:";
const CREDENTIAL_CIPHER_ALGORITHM = "aes-256-gcm";
const CREDENTIAL_CIPHER_IV_BYTES = 12;
const CREDENTIAL_CIPHER_AUTH_TAG_BYTES = 16;
const CREDENTIAL_SECRET_ENV_KEY = "ZCODE_CREDENTIAL_SECRET";

export interface ZCodeCredentialCipher {
  decrypt(value: string, credentialKey?: string): Promise<string>;
  encrypt(value: string): Promise<string>;
}

export interface ZCodeCredentialCipherOptions {
  env?: Record<string, string | undefined>;
  /**
   * Legacy migration callback: fired (fire-and-forget) after a value encrypted with the
   * pre-P2 machine-derived key is decrypted successfully. The host re-encrypts and writes
   * the entry back using its own atomic save + file lock, guarding against concurrent
   * mutations by comparing the original ciphertext.
   */
  onLegacyValueMigrated?: (
    credentialKey: string,
    plaintext: string,
    legacyEncryptedValue: string,
  ) => void;
}

/**
 * Legacy: before BYOK P2 the cipher key was derived from machine info
 * (platform/homedir/username). Kept private and used ONLY to decrypt and migrate
 * historical ciphertext; never for encryption. New ciphertext always uses
 * resolveCredentialMasterKey (env secret or OS keychain).
 */
function deriveLegacyCipherKey(): Buffer {
  let username = "unknown";
  try {
    username = userInfo().username;
  } catch {
    // Some packaged or sandboxed runtimes cannot resolve OS user info.
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

function parseEncryptedPayload(value: string): DecryptedPayload {
  const payload = value.slice(ENCRYPTED_VALUE_PREFIX.length);
  const parts = payload.split(".");
  const [ivRaw, authTagRaw, cipherRaw] = parts;

  if (!ivRaw || !authTagRaw || !cipherRaw || parts.length !== 3) {
    throw new Error("Credential decrypt failed: invalid ciphertext format");
  }

  const iv = Buffer.from(ivRaw, "base64url");
  const authTag = Buffer.from(authTagRaw, "base64url");
  const cipherText = Buffer.from(cipherRaw, "base64url");

  if (iv.length !== CREDENTIAL_CIPHER_IV_BYTES) {
    throw new Error("Credential decrypt failed: invalid IV length");
  }
  if (authTag.length !== CREDENTIAL_CIPHER_AUTH_TAG_BYTES) {
    throw new Error("Credential decrypt failed: invalid auth tag length");
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
  } catch (error) {
    throw new Error("Credential decrypt failed: key mismatch or corrupted ciphertext", {
      cause: error,
    });
  } finally {
    // Zero intermediate plaintext buffers after use.
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
      iv.toString("base64url"),
      ".",
      authTag.toString("base64url"),
      ".",
      encrypted.toString("base64url"),
    ].join("");
  } finally {
    // Zero intermediate ciphertext buffers after use (the key may be a shared cached one).
    encrypted?.fill(0);
  }
}

export function createZCodeCredentialCipher(
  options: ZCodeCredentialCipherOptions = {},
): ZCodeCredentialCipher {
  const env = options.env ?? process.env;
  const onLegacyValueMigrated = options.onLegacyValueMigrated;

  return {
    async decrypt(value: string, credentialKey?: string): Promise<string> {
      if (!isEncryptedZCodeCredentialValue(value)) {
        return value;
      }

      // Validate the payload format before resolving the key, so malformed ciphertext
      // never triggers a keychain subprocess.
      const payload = parseEncryptedPayload(value);
      const key = await resolveCredentialMasterKey(env);

      try {
        return aesGcmDecrypt(key, payload);
      } catch {
        // New-key decryption failed: the value may be legacy ciphertext written by the
        // machine-derived key. Retry once with the legacy key; on success return the
        // plaintext and fire the migration callback.
        try {
          const legacyKey = deriveLegacyCipherKey();
          const plaintext = aesGcmDecrypt(legacyKey, payload);
          if (onLegacyValueMigrated && credentialKey !== undefined) {
            try {
              onLegacyValueMigrated(credentialKey, plaintext, value);
            } catch {
              // Migration callback failures are silent: reads must not break on write-back.
            }
          }
          return plaintext;
        } catch (legacyError) {
          throw new Error("Credential decrypt failed: key mismatch or corrupted ciphertext", {
            cause: legacyError,
          });
        }
      }
    },

    async encrypt(value: string): Promise<string> {
      const key = await resolveCredentialMasterKey(env);
      return aesGcmEncrypt(key, value);
    },
  };
}

export function isEncryptedZCodeCredentialValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_VALUE_PREFIX);
}
