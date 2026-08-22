import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ProgressBar from "./ProgressBar";

const meta: Meta<typeof ProgressBar> = {
  title: "Components/Onboarding/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const PartialProgress: Story = {
  args: {
    current: 2,
    total: 4,
    showLabel: true,
    size: "md",
  },
};

export const CompleteProgress: Story = {
  args: {
    current: 5,
    total: 5,
    showLabel: true,
    size: "md",
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="space-y-4 max-w-md">
      <ProgressBar current={1} total={4} size="sm" />
      <ProgressBar current={2} total={4} size="md" />
      <ProgressBar current={3} total={4} size="lg" />
    </div>
  ),
};
