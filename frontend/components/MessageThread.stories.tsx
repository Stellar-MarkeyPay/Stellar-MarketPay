import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import MessageThread from "./MessageThread";

const meta: Meta<typeof MessageThread> = {
  title: "Components/MessageThread",
  component: MessageThread,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MessageThread>;

export const Default: Story = {
  args: {
    jobId: "job-101",
    currentUserAddress: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    otherUserAddress: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUV",
  },
};
