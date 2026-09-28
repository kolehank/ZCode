import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeSocketFrame,
  SocketFrameDecoder,
} from "../src/main/webRemoteAccess/socketFrameBridge.js";
import { ProtocolMessageType } from "@zcode/rpc";

/** 按浏览器 SocketProtocol 的线格式构造 Regular 帧：13 字节头 + body。 */
function encodeBrowserFrame(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(13 + payload.byteLength);
  frame[0] = ProtocolMessageType.Regular;
  const view = new DataView(frame.buffer);
  view.setUint32(9, payload.byteLength, false);
  frame.set(payload, 13);
  return frame;
}

test("浏览器帧 → Host 裸消息：单帧完整到达", () => {
  const decoder = new SocketFrameDecoder();
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const out = decoder.push(encodeBrowserFrame(payload));
  assert.equal(out.length, 1);
  assert.deepEqual([...out[0]], [...payload]);
});

test("帧头与 body 跨 chunk 分片也能正确重组", () => {
  const decoder = new SocketFrameDecoder();
  const frame = encodeBrowserFrame(new Uint8Array([9, 8, 7]));
  const out1 = decoder.push(frame.slice(0, 5)); // 帧头截断
  assert.deepEqual(out1, []);
  const out2 = decoder.push(frame.slice(5, 12)); // body 截断
  assert.deepEqual(out2, []);
  const out3 = decoder.push(frame.slice(12));
  assert.equal(out3.length, 1);
  assert.deepEqual([...out3[0]], [9, 8, 7]);
});

test("多条消息粘包、空 payload、非 Regular 帧丢弃", () => {
  const decoder = new SocketFrameDecoder();
  const ackFrame = new Uint8Array(13);
  ackFrame[0] = ProtocolMessageType.Ack;
  const emptyRegular = encodeBrowserFrame(new Uint8Array(0));
  const first = encodeBrowserFrame(new Uint8Array([10]));
  const second = encodeBrowserFrame(new Uint8Array([20, 30]));
  const out = decoder.push(new Uint8Array([...ackFrame, ...emptyRegular, ...first, ...second]));
  assert.equal(out.length, 3);
  assert.deepEqual([...out[0]], []);
  assert.deepEqual([...out[1]], [10]);
  assert.deepEqual([...out[2]], [20, 30]);
});

test("Host 裸消息 → 浏览器帧：与 rpc SocketProtocol 的读取约定一致", () => {
  const payload = new Uint8Array([4, 5, 6]);
  const frame = encodeSocketFrame(payload);
  assert.equal(frame[0], ProtocolMessageType.Regular);
  assert.equal(new DataView(frame.buffer).getUint32(9, false), payload.byteLength);
  assert.deepEqual([...frame.subarray(13)], [...payload]);

  // 用 SocketFrameDecoder 反解自身产物，验证往返一致性。
  const roundTrip = new SocketFrameDecoder().push(frame);
  assert.equal(roundTrip.length, 1);
  assert.deepEqual([...roundTrip[0]], [...payload]);
});
