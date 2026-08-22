import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import FreelancerProfileSkeleton from "./FreelancerProfileSkeleton";

const meta: Meta<typeof FreelancerProfileSkeleton> = {
  title: "Components/FreelancerProfileSkeleton",
  component: FreelancerProfileSkeleton,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FreelancerProfileSkeleton>;

export const Default: Story = {};
