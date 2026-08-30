import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Navbar from "./Navbar";

const meta: Meta<typeof Navbar> = {
  title: "Components/Navbar",
  component: Navbar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Navbar>;

export const LoggedOut: Story = {
  args: {
    publicKey: null,
    onConnect: () => console.log("Connect Wallet"),
    onDisconnect: () => console.log("Disconnect Wallet"),
  },
};

export const LoggedIn: Story = {
  args: {
    publicKey: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    onConnect: () => console.log("Connect Wallet"),
    onDisconnect: () => console.log("Disconnect Wallet"),
  },
};
