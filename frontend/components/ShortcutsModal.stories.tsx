import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ShortcutsModal from "./ShortcutsModal";

const meta: Meta<typeof ShortcutsModal> = {
  title: "Components/ShortcutsModal",
  component: ShortcutsModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ShortcutsModal>;

export const GlobalShortcuts: Story = {
  args: {
    isOpen: true,
    showJobDetailShortcuts: false,
    onClose: () => console.log("Closed"),
  },
};

export const WithJobDetailShortcuts: Story = {
  args: {
    isOpen: true,
    showJobDetailShortcuts: true,
    onClose: () => console.log("Closed"),
  },
};
