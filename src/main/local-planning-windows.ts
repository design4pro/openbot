import { sourceText } from "@openbot/i18n/source";
import { isTrustedRendererUrl } from "./trusted-renderer";

export interface PlanningFrame {
  readonly processId: number;
  readonly routingId: number;
  readonly url: string;
}
export interface PlanningRenderer {
  readonly id: number;
  readonly mainFrame: PlanningFrame;
  isDestroyed(): boolean;
}
export interface PlanningSender {
  readonly sender: PlanningRenderer;
  readonly senderFrame: PlanningFrame | null;
}
interface PrivateExposure {
  contents: PlanningRenderer;
  frame: PlanningFrame;
  processId: number;
  routingId: number;
  epoch: string;
}
export interface LocalPlanningWindowsOptions {
  replace(contents: readonly PlanningRenderer[]): Promise<void>;
}

/** Owns main-window authority and all private WebContents references, including hidden or withdrawn views. */
export class LocalPlanningWindows {
  readonly #options: LocalPlanningWindowsOptions;
  readonly #main = new Map<number, PlanningRenderer>();
  readonly #private = new Map<PlanningRenderer, PrivateExposure>();
  constructor(options: LocalPlanningWindowsOptions) {
    this.#options = options;
  }
  registerMain(contents: PlanningRenderer): void {
    this.#main.set(contents.id, contents);
  }
  unregisterMain(contents: PlanningRenderer): void {
    for (const [id, registered] of this.#main) {
      if (registered === contents) {
        this.#main.delete(id);
        return;
      }
    }
  }
  requireSender(event: PlanningSender): PlanningRenderer {
    const { sender, senderFrame } = event;
    const exposure = this.#private.get(sender);
    try {
      if (
        this.#main.get(sender.id) !== sender ||
        sender.isDestroyed() ||
        !senderFrame ||
        sender.mainFrame !== senderFrame ||
        !isTrustedRendererUrl(senderFrame.url) ||
        (exposure &&
          (exposure.frame !== senderFrame ||
            exposure.processId !== senderFrame.processId ||
            exposure.routingId !== senderFrame.routingId))
      )
        throw new Error("Invalid planning sender.");
      return sender;
    } catch {
      throw new Error(sourceText("error.backend.planningForbidden"));
    }
  }
  enroll(contents: PlanningRenderer, epoch: string): void {
    this.requireSender({ sender: contents, senderFrame: contents.mainFrame });
    const previous = this.#private.get(contents);
    if (previous && previous.epoch !== epoch) throw new Error("A private renderer cannot change epochs.");
    if (!previous)
      this.#private.set(contents, {
        contents,
        frame: contents.mainFrame,
        processId: contents.mainFrame.processId,
        routingId: contents.mainFrame.routingId,
        epoch,
      });
  }
  privateRenderersDestroyed(): boolean {
    for (const { contents } of this.#private.values()) if (!contents.isDestroyed()) return false;
    return true;
  }
  async destroyPrivate(epoch: string): Promise<void> {
    const exposures = [...this.#private.values()].filter((value) => value.epoch === epoch);
    await this.#options.replace(
      exposures.filter((value) => !value.contents.isDestroyed()).map((value) => value.contents),
    );
    if (exposures.some((value) => !value.contents.isDestroyed())) throw new Error("Private renderers are still alive.");
    for (const exposure of exposures) this.#private.delete(exposure.contents);
  }
}
