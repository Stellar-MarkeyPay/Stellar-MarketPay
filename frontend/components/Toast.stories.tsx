import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ToastSnapshot } from "./Toast";

const meta: Meta<typeof ToastSnapshot> = {
  title: "Components/Toast",
  component: ToastSnapshot,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ToastSnapshot>;

export const Success: Story = {
  args: {
    variant: "success",
    message: "Escrow funds locked successfully in Soroban contract.",
  },
};

export const Error: Story = {
  args: {
    variant: "error",
    message: "Transaction failed: Insufficient fee allowance.",
  },
};

export const Info: Story = {
  args: {
    variant: "info",
    message: "Application proposal saved to drafts.",
  },
};

export const LongMessage: Story = {
  args: {
    variant: "info",
    message:
      "A new milestone payment of 500 XLM has been funded and will be automatically verified by the oracle upon completion.",
  },
};
