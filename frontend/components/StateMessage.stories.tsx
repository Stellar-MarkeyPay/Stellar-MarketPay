import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import StateMessage from "./StateMessage";

const meta: Meta<typeof StateMessage> = {
  title: "Components/StateMessage",
  component: StateMessage,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof StateMessage>;

export const EmptyState: Story = {
  args: {
    type: "empty",
    title: "No Jobs Found",
    description: "Try adjusting your search filters or browse all active categories.",
    ctaLabel: "Clear All Filters",
    onCta: () => console.log("CTA Clicked"),
  },
};

export const ErrorState: Story = {
  args: {
    type: "error",
    title: "Failed to Load Escrow Contracts",
    description: "The Stellar Horizon node is currently experiencing network delays.",
    ctaLabel: "Retry Connection",
    onCta: () => console.log("Retry Clicked"),
  },
};
