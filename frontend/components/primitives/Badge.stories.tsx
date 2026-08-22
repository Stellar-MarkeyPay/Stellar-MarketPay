import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Badge from "./Badge";

const meta: Meta<typeof Badge> = {
  title: "Primitives/Badge",
  component: Badge,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    children: "Open for Bids",
    variant: "open",
    dot: true,
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Badge variant="open" dot>
        Open
      </Badge>
      <Badge variant="progress" dot>
        In Progress
      </Badge>
      <Badge variant="complete" dot>
        Completed
      </Badge>
      <Badge variant="cancelled" dot>
        Cancelled
      </Badge>
      <Badge variant="disputed" dot>
        Disputed
      </Badge>
      <Badge variant="gold">⚡ Featured</Badge>
      <Badge variant="neutral">Smart Contracts</Badge>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Badge size="sm" variant="open" dot>
        Small (xs)
      </Badge>
      <Badge size="md" variant="open" dot>
        Medium (sm)
      </Badge>
    </div>
  ),
};
