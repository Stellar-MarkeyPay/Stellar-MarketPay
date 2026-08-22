import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ReferralDashboard from "./ReferralDashboard";

const meta: Meta<typeof ReferralDashboard> = {
  title: "Components/ReferralDashboard",
  component: ReferralDashboard,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ReferralDashboard>;

export const Default: Story = {
  args: {
    publicKey: "GACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  },
};
