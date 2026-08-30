import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Skeleton from "./Skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "Primitives/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Text: Story = {
  render: () => (
    <div className="space-y-2 max-w-md">
      <Skeleton variant="text" width="60%" />
      <Skeleton variant="text" />
      <Skeleton variant="text" width="80%" />
    </div>
  ),
};

export const Avatar: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Skeleton variant="circle" width={48} height={48} />
      <div className="space-y-2 flex-1 max-w-xs">
        <Skeleton variant="text" width="50%" />
        <Skeleton variant="text" width="30%" />
      </div>
    </div>
  ),
};

export const CardSkeleton: Story = {
  render: () => <Skeleton variant="card" className="max-w-md" />,
};
