import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import WithdrawToBankModal from "./WithdrawToBankModal";

const meta: Meta<typeof WithdrawToBankModal> = {
  title: "Components/WithdrawToBankModal",
  component: WithdrawToBankModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof WithdrawToBankModal>;

export const Default: Story = {
  args: {
    publicKey: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    onClose: () => console.log("Closed"),
  },
};
