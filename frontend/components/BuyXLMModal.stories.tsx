import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import BuyXLMModal from "./BuyXLMModal";

const meta: Meta<typeof BuyXLMModal> = {
  title: "Components/BuyXLMModal",
  component: BuyXLMModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof BuyXLMModal>;

export const Default: Story = {
  args: {
    publicKey: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    onClose: () => console.log("Closed"),
    onComplete: () => console.log("Completed"),
  },
};
