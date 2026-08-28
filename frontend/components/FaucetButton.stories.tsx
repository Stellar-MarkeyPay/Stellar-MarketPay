import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import FaucetButton from "./FaucetButton";

const meta: Meta<typeof FaucetButton> = {
  title: "Components/FaucetButton",
  component: FaucetButton,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FaucetButton>;

export const Default: Story = {
  args: {
    publicKey: "GACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    currentBalance: "0",
    onBalanceUpdate: (b: any) => console.log("Balance updated:", b),
  },
};
