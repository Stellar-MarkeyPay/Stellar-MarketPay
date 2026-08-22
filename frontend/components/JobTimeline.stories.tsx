import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import JobTimeline from "./JobTimeline";

const meta: Meta<typeof JobTimeline> = {
  title: "Components/JobTimeline",
  component: JobTimeline,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof JobTimeline>;

export const Posted: Story = {
  args: {
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
};

export const InProgress: Story = {
  args: {
    status: "in_progress",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
  },
};

export const Completed: Story = {
  args: {
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-20T00:00:00.000Z",
  },
};

export const Disputed: Story = {
  args: {
    status: "disputed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    disputedAt: "2026-01-15T00:00:00.000Z",
  },
};
