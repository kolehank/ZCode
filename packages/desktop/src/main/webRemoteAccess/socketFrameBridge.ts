// BYOK A2：浏览器 SocketProtocol 分帧 ↔ Host MessagePortProtocol 裸消息 的帧转换。
//
// 内嵌 server 的 WS 桥两端协议不同：
// - 浏览器端 connectViaWebSocket 用 SocketProtocol——每条 RPC 消息带 13 字节帧头
//   （type u8 | id u32BE | ack u32BE | length u32BE，见 packages/rpc/src/protocol.ts）；
// - Host 端 attachment registry 用 MessagePortProtocol——每条端口消息就是裸 VSBuffer，
//   没有帧头。
// 桥必须做帧转换：解出 Regular 帧的 body 再投递给端口，反向为裸消息包上 Regular 帧。
// 之前原样透传字节，Host 收到的每条消息都带着帧头垃圾，ChannelServer 解析失败，
// 浏览器端 connectViaWebSocket 的握手永远等不到应答（黑屏、无任何报错）。
import { ChunkStream, ProtocolMessageType, VSBuffer } from "@zcode/rpc";

/** SocketProtocol 的帧头长度：type(1) + id(4) + ack(4) + length(4)。 */
const SOCKET_HEADER_SIZE = 13;

/**
 * 增量解码浏览器方向的 SocketProtocol 帧，产出 Regular 帧的 payload（即 Host 端
 * MessagePortProtocol 期望的裸消息）。非 Regular 帧（Ack/KeepAlive 等socket 层帧）
 * 在 Host 的 MessagePort 上没有对应概念，丢弃。
 */
export class SocketFrameDecoder {
  readonly #stream = new ChunkStream();

  push(chunk: Uint8Array): Uint8Array[] {
    this.#stream.acceptChunk(VSBuffer.wrap(chunk));
    const payloads: Uint8Array[] = [];
    for (;;) {
      const header = this.#stream.peek(SOCKET_HEADER_SIZE);
      if (!header) break;
      const type = header.readUInt8(0);
      const length = header.readUInt32BE(9);
      if (this.#stream.byteLength < SOCKET_HEADER_SIZE + length) break;
      this.#stream.skip(SOCKET_HEADER_SIZE);
      const body = length === 0 ? VSBuffer.alloc(0) : this.#stream.read(length);
      if (!body) {
        throw new Error("SocketFrameDecoder 读取到完整帧长度后 body 不应为空");
      }
      if (type === ProtocolMessageType.Regular) {
        payloads.push(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
      }
    }
    return payloads;
  }
}

/** 把 Host 端裸消息包装成浏览器 SocketProtocol 期望的 Regular 帧。 */
export function encodeSocketFrame(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(SOCKET_HEADER_SIZE + payload.byteLength);
  frame[0] = ProtocolMessageType.Regular;
  const view = new DataView(frame.buffer);
  view.setUint32(9, payload.byteLength, false);
  frame.set(payload, SOCKET_HEADER_SIZE);
  return frame;
}
