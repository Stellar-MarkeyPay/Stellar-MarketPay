import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import AdminAnalytics from "./AdminAnalytics";

const meta: Meta<typeof AdminAnalytics> = {
  title: "Components/AdminAnalytics",
  component: AdminAnalytics,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof AdminAnalytics>;

export const Default: Story = {
  args: {
    publicKey: "GADMINACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  },
};

export const LoggedOut: Story = {
  args: {
    publicKey: null,
  },
};
