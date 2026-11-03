import { PrivatePlanningAdmission } from "../../src/main/private-planning-admission";
import { PrivatePlanningNative } from "../../src/main/private-planning-native";

/** Service-only fixture; it makes no claim about a private renderer or a certified platform. */
export function nativePlanningFixture(stateDirectory: string, nativeArguments: () => readonly string[] = () => []) {
  const admission = new PrivatePlanningAdmission({
    checkQuiescent: () => native.checkQuiescent(),
    privateRenderersDestroyed: () => true,
  });
  const native = new PrivatePlanningNative({ admission, stateDirectory, nativeArguments });
  return { admission, native };
}
