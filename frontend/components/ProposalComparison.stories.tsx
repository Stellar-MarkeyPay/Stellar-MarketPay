import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ProposalComparison from "./ProposalComparison";

const meta: Meta<typeof ProposalComparison> = {
  title: "Components/ProposalComparison",
  component: ProposalComparison,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ProposalComparison>;

export const Default: Story = {};
