/**
 * useCredentials —— 凭据服务 hooks
 *
 * BYOK：厂商 OAuth 登录下线后，凭据服务只承载 api-key 等用户自配凭据。
 */
import { useCallback } from "react";
import { useServices } from "./useServices.js";

/** 凭据管理的基础 hook */
export function useCredentials() {
  const { credentialService } = useServices();

  const load = useCallback((key: string) => credentialService.load(key), [credentialService]);
  const save = useCallback(
    (key: string, value: string) => credentialService.save(key, value),
    [credentialService],
  );
  const del = useCallback((key: string) => credentialService.delete(key), [credentialService]);

  return { load, save, delete: del };
}
