import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import PasskeyManager from "./PasskeyManager";

const meta: Meta<typeof PasskeyManager> = {
  title: "Components/PasskeyManager",
  component: PasskeyManager,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof PasskeyManager>;

export const Default: Story = {
  args: {
    publicKey: "GACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  },
};
