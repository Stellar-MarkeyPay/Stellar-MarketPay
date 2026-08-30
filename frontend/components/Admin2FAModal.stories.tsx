import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Admin2FAModal from "./Admin2FAModal";

const meta: Meta<typeof Admin2FAModal> = {
  title: "Components/Admin2FAModal",
  component: Admin2FAModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Admin2FAModal>;

export const SetupMode: Story = {
  args: {
    mode: "setup",
    onComplete: () => console.log("2FA Setup Completed"),
  },
};

export const VerifyMode: Story = {
  args: {
    mode: "verify",
    onComplete: () => console.log("2FA Verified"),
  },
};
