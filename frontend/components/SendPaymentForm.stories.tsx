import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import SendPaymentForm from "./SendPaymentForm";

const meta: Meta<typeof SendPaymentForm> = {
  title: "Components/SendPaymentForm",
  component: SendPaymentForm,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SendPaymentForm>;

export const Default: Story = {
  args: {
    fromPublicKey: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  },
};
