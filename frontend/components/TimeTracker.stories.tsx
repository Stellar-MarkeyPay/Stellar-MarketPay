import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import TimeTracker from "./TimeTracker";

const meta: Meta<typeof TimeTracker> = {
  title: "Components/TimeTracker",
  component: TimeTracker,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TimeTracker>;

export const FreelancerView: Story = {
  args: {
    jobId: "job-101",
    isFreelancer: true,
    isClient: false,
  },
};

export const ClientReviewView: Story = {
  args: {
    jobId: "job-101",
    isFreelancer: false,
    isClient: true,
  },
};
