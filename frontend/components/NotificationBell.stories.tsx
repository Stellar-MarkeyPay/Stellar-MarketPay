import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import NotificationBell from "./NotificationBell";

const meta: Meta<typeof NotificationBell> = {
  title: "Components/NotificationBell",
  component: NotificationBell,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof NotificationBell>;

export const Default: Story = {
  args: {
    publicKey: "GACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  },
};
