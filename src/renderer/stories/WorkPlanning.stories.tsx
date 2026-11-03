import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { PrototypeApp } from "./prototype-support";

const meta = {
  title: "Work/Local planning",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
/** Open Work from the real rail. Preview uses the local in-memory contract, not native privacy proof. */
export const InApplication: Story = { render: () => <PrototypeApp /> };
