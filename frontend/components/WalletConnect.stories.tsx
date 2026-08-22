import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import WalletConnect from "./WalletConnect";

const meta: Meta<typeof WalletConnect> = {
  title: "Components/WalletConnect",
  component: WalletConnect,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof WalletConnect>;

export const Default: Story = {
  args: {
    onConnect: (pk) => console.log("Connected with public key:", pk),
  },
};
