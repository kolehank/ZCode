import assert from "node:assert/strict";
import test from "node:test";
import { createModelTelemetry } from "../src/telemetry-noop.js";

test("noop 端口按契约执行 run 回调并返回结果（turn 执行体不被吞掉）", () => {
  const { agentExecution } = createModelTelemetry();
  const executed = agentExecution.startTurn({ turnNumber: 1 }).run(() => 42);
  assert.equal(executed, 42);
  // 异步执行体（turn 真实路径返回 Promise）原样透传。
  const asyncResult = agentExecution.startTurn({}).run(async () => "ok");
  assert.ok(asyncResult instanceof Promise);
});

test("深层链式 writer（call → attempt → run）同样执行回调", () => {
  const { modelExecution } = createModelTelemetry();
  let marker = 0;
  const result = modelExecution
    .startCall({ sessionId: "sess_x" } as Parameters<typeof modelExecution.startCall>[0])
    .startAttempt({ requestId: "req_1" } as Parameters<
      ReturnType<typeof modelExecution.startCall>["startAttempt"]
    >[0])
    .run(() => {
      marker = 7;
      return marker;
    });
  assert.equal(result, 7);
  assert.equal(marker, 7);
});

test("noop 端口与任意 writer 都不是 thenable（await 立即返回而不是永久挂起）", async () => {
  const { agentExecution } = createModelTelemetry();
  const writer = agentExecution.startTurn({});
  assert.equal((writer as { then?: unknown }).then, undefined);
  const timeout = new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1000));
  const awaited = await Promise.race([Promise.resolve(agentExecution), timeout]);
  assert.notEqual(awaited, "hung");
});

test("captureCausation 按契约返回 undefined，mark/finish 链式调用不抛错", () => {
  const { agentExecution } = createModelTelemetry();
  assert.equal(agentExecution.captureCausation(), undefined);
  const writer = agentExecution.startTurn({});
  assert.equal(writer.captureCausation(), undefined);
  assert.doesNotThrow(() => {
    writer.finishCompleted("assistant_message");
    writer.finishFailed("model", "unknown", new Error("noop"));
    writer.finishCancelled("abort_signal");
  });
});
