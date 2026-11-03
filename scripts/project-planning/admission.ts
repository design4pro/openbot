import assert from "node:assert/strict";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Fiber, Result } from "effect";
import { PrivatePlanningAdmission, PrivatePlanningError } from "../../src/main/private-planning-admission";
import { type CaptureImage, ScreenCapturer, type ScreenCapturerOptions } from "../../src/main/screen-capture";

// Real admission and capture services with a controlled native I/O port. No native proof is claimed.
export async function admissionCases(): Promise<string[]> {
  const cases: string[] = [];
  const logger = createOpenBotLogger("planning-admission");
  const record = (id: string) => {
    cases.push(id);
    logger.info("Admission case passed.", { caseId: id });
  };
  let destroyed = false;
  const coordinator = new PrivatePlanningAdmission({
    checkQuiescent: () => Effect.void,
    privateRenderersDestroyed: () => destroyed,
  });
  const lease = await Effect.runPromise(coordinator.acquirePublic("runtime", "cua_runtime"));
  const blocked = await Effect.runPromise(Effect.result(coordinator.enterPrivate()));
  assert.ok(Result.isFailure(blocked));
  assert.equal(blocked.failure.code, "privacy_busy");
  lease.markUncertain();
  assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(coordinator.enterPrivate()))));
  lease.releaseVerified();
  const replacement = await Effect.runPromise(coordinator.acquirePublic("runtime", "cua_runtime"));
  lease.releaseVerified();
  assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(coordinator.enterPrivate()))));
  replacement.releaseVerified();
  record("public-lifetime");

  await Effect.runPromise(coordinator.enterPrivate());
  const epoch = coordinator.snapshot().epoch;
  await Effect.runPromise(coordinator.enterPrivate());
  assert.equal(coordinator.snapshot().epoch, epoch);
  assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(coordinator.acquirePublic("capture", "capture")))));
  record("private-denial");
  assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(coordinator.finishPrivateExit()))));
  assert.equal(coordinator.snapshot().phase, "private");
  destroyed = true;
  await Effect.runPromise(coordinator.finishPrivateExit());
  assert.equal(coordinator.snapshot().phase, "public");
  record("exit-destruction");

  const enteredCheck = Deferred.makeUnsafe<void>();
  const finishCheck = Deferred.makeUnsafe<void>();
  const racing = new PrivatePlanningAdmission({
    privateRenderersDestroyed: () => true,
    checkQuiescent: () =>
      Effect.gen(function* () {
        yield* Deferred.succeed(enteredCheck, undefined);
        yield* Deferred.await(finishCheck);
      }),
  });
  const entering = Effect.runPromise(racing.enterPrivate());
  await Effect.runPromise(Deferred.await(enteredCheck));
  const publicAttempt = await Effect.runPromise(Effect.result(racing.acquirePublic("racing", "capture")));
  assert.ok(Result.isFailure(publicAttempt));
  assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(racing.enterPrivate()))));
  await Effect.runPromise(Deferred.succeed(finishCheck, undefined));
  await entering;
  assert.equal(Number(racing.snapshot().phase === "private") + Number(Result.isSuccess(publicAttempt)), 1);
  record("admission-race");
  let quiescent = false;
  const unknown = new PrivatePlanningAdmission({
    privateRenderersDestroyed: () => true,
    checkQuiescent: () => (quiescent ? Effect.void : Effect.fail(new PrivatePlanningError({ code: "privacy_busy" }))),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(unknown.enterPrivate()))));
    assert.equal(unknown.snapshot().epoch, 0);
  }
  quiescent = true;
  await Effect.runPromise(unknown.enterPrivate());
  assert.equal(unknown.snapshot().epoch, 1);
  record("quiescence-refusal");

  let nativeCalls = 0;
  const image: CaptureImage = {
    isEmpty: () => false,
    getSize: () => ({ width: 1, height: 1 }),
    crop: () => image,
    resize: () => image,
    toPNG: () => Uint8Array.of(1),
  };
  const source = { id: "window:fixture", name: "Synthetic", display_id: "1", thumbnail: image };
  const options: ScreenCapturerOptions = {
    platform: "linux",
    screenAccess: () => "granted",
    admission: coordinator,
    displays: () => [{ id: 1, label: "Synthetic", bounds: { x: 0, y: 0, width: 1, height: 1 }, scaleFactor: 1 }],
    primaryDisplayId: () => 1,
    getSources: async () => {
      nativeCalls++;
      return [source];
    },
  };
  const capture = new ScreenCapturer(options);
  await Effect.runPromise(coordinator.enterPrivate());
  assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(capture.listSources()))));
  assert.ok(
    Result.isFailure(
      await Effect.runPromise(Effect.result(capture.capture({ target: "window", windowId: source.id }))),
    ),
  );
  assert.equal(nativeCalls, 0);
  await Effect.runPromise(coordinator.finishPrivateExit());
  assert.equal((await Effect.runPromise(capture.listSources())).windows.length, 1);
  assert.equal(nativeCalls, 1);
  record("capture-refusal");
  const deliveryStarted = Deferred.makeUnsafe<void>();
  const deliveryFinished = Deferred.makeUnsafe<void>();
  const delivery = Effect.runPromise(
    capture.withCaptureLease(
      Effect.gen(function* () {
        yield* Deferred.succeed(deliveryStarted, undefined);
        yield* Deferred.await(deliveryFinished);
      }),
    ),
  );
  await Effect.runPromise(Deferred.await(deliveryStarted));
  assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(coordinator.enterPrivate()))));
  await Effect.runPromise(Deferred.succeed(deliveryFinished, undefined));
  await delivery;
  await Effect.runPromise(coordinator.enterPrivate());
  await Effect.runPromise(coordinator.finishPrivateExit());
  record("capture-delivery-lifetime");

  const nativeStarted = Deferred.makeUnsafe<void>();
  const nativeResult = Promise.withResolvers<Awaited<ReturnType<ScreenCapturerOptions["getSources"]>>>();
  const delayed = new ScreenCapturer({
    ...options,
    getSources: async () => {
      await Effect.runPromise(Deferred.succeed(nativeStarted, undefined));
      return nativeResult.promise;
    },
  });
  let published = false;
  const capturing = Effect.runFork(
    delayed.capture({ target: "window", windowId: source.id }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          published = true;
        }),
      ),
    ),
  );
  await Effect.runPromise(Deferred.await(nativeStarted));
  const interrupted = Effect.runPromise(Fiber.interrupt(capturing));
  assert.ok(
    Result.isFailure(await Effect.runPromise(Effect.result(coordinator.enterPrivate()))),
    "An interrupted capture must hold its lease until native I/O settles",
  );
  nativeResult.resolve([source]);
  await interrupted;
  assert.equal(published, false);
  await Effect.runPromise(coordinator.enterPrivate());
  record("capture-cancellation");
  return cases;
}
