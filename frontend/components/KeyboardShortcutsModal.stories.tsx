import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";

const meta: Meta<typeof KeyboardShortcutsModal> = {
  title: "Components/KeyboardShortcutsModal",
  component: KeyboardShortcutsModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof KeyboardShortcutsModal>;

export const Open: Story = {
  args: {
    isOpen: true,
    onClose: () => console.log("Closed"),
  },
};
