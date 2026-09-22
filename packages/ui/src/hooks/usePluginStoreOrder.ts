// 插件商店排序原经厂商客户端配置服务远端下发；
// 该远程配置通道已随厂商云功能下线，排序降级为本地默认（order 恒为 null），
// 消费方（pluginsMentionProvider / WorkspacePluginPreview / PluginStorePage）按默认顺序展示。
export function usePluginStoreOrder(enabled = true) {
  void enabled;
  return { order: null, refresh: async () => undefined };
}
